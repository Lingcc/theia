/********************************************************************************
 * Copyright (C) 2018 TypeFox and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import * as React from 'react';
import { DebugProtocol } from 'vscode-debugprotocol/lib/debugProtocol';
import { MessageType } from '@theia/core/lib/common';
import { ConsoleItem, CompositeConsoleItem } from '@theia/console/lib/browser/console-session';
import { DebugSession } from '../debug-session';
import { DebugSessionConnection } from '../debug-session-connection';

export class ExpressionContainer implements CompositeConsoleItem {

    private static readonly BASE_CHUNK_SIZE = 100;

    protected readonly connection: DebugSessionConnection | undefined;
    protected variablesReference: number;
    protected namedVariables: number | undefined;
    protected indexedVariables: number | undefined;
    protected readonly startOfVariables: number;

    constructor(options: ExpressionContainer.Options) {
        this.connection = options.connection;
        this.variablesReference = options.variablesReference || 0;
        this.namedVariables = options.namedVariables;
        this.indexedVariables = options.indexedVariables;
        this.startOfVariables = options.startOfVariables || 0;
    }

    get empty(): boolean {
        return false;
    }

    render(): React.ReactNode {
        return undefined;
    }

    get hasChildren(): boolean {
        return !!this.variablesReference;
    }

    protected items: Promise<ConsoleItem[]> | undefined;
    async resolve(): Promise<ConsoleItem[]> {
        if (!this.hasChildren || !this.connection) {
            return [];
        }
        if (this.items) {
            return this.items;
        }
        return this.items || (this.items = this.doResolve());
    }
    protected async doResolve(): Promise<ConsoleItem[]> {
        const result: ConsoleItem[] = [];
        if (this.namedVariables) {
            this.fetch(result, 'named');
        }
        if (this.indexedVariables) {
            let chunkSize = ExpressionContainer.BASE_CHUNK_SIZE;
            while (this.indexedVariables > chunkSize * ExpressionContainer.BASE_CHUNK_SIZE) {
                chunkSize *= ExpressionContainer.BASE_CHUNK_SIZE;
            }
            if (this.indexedVariables > chunkSize) {
                const numberOfChunks = Math.ceil(this.indexedVariables / chunkSize);
                for (let i = 0; i < numberOfChunks; i++) {
                    const start = this.startOfVariables + i * chunkSize;
                    const count = Math.min(chunkSize, this.indexedVariables - i * chunkSize);
                    const { connection, variablesReference } = this;
                    result.push(new VirtualVariableItem({
                        connection, variablesReference,
                        namedVariables: 0,
                        indexedVariables: count,
                        startOfVariables: start,
                        name: `[${start}..${start + count - 1}]`
                    }));
                }
                return result;
            }
        }
        await this.fetch(result, 'indexed', this.startOfVariables, this.indexedVariables);
        return result;
    }

    protected fetch(result: ConsoleItem[], filter: 'named'): Promise<void>;
    protected fetch(result: ConsoleItem[], filter: 'indexed', start: number, count?: number): Promise<void>;
    protected async fetch(result: ConsoleItem[], filter: 'indexed' | 'named', start?: number, count?: number): Promise<void> {
        try {
            const { variablesReference } = this;
            const response = await this.connection!.sendRequest('variables', { variablesReference, filter, start, count });
            const { variables } = response.body;
            const names = new Set<string>();
            for (const variable of variables) {
                if (!names.has(variable.name)) {
                    result.push(new VariableItem(this.connection!, variable));
                    names.add(variable.name);
                }
            }
        } catch (e) {
            result.push({
                severity: MessageType.Error,
                empty: !!e.message,
                render: () => e.message
            });
        }
    }

}
export namespace ExpressionContainer {
    export interface Options {
        connection: DebugSessionConnection | undefined,
        variablesReference?: number
        namedVariables?: number
        indexedVariables?: number
        startOfVariables?: number
    }
}

export class VariableItem extends ExpressionContainer {

    static booleanRegex = /^true|false$/i;
    static stringRegex = /^(['"]).*\1$/;

    constructor(
        protected readonly connection: DebugSessionConnection | undefined,
        protected readonly variable: DebugProtocol.Variable
    ) {
        super({
            connection,
            variablesReference: variable.variablesReference,
            namedVariables: variable.namedVariables,
            indexedVariables: variable.indexedVariables
        });
    }

    render(): React.ReactNode {
        const { type, value, name } = this.variable;
        return <div className={this.variableClassName}>
            <span title={type || name} className='name'>{name}{!!value && ': '}</span>
            <span title={value} >{value}</span>
        </div>;
    }

    protected get variableClassName(): string {
        const { type, value } = this.variable;
        const classNames = ['theia-debug-console-variable'];
        if (type === 'number' || type === 'boolean' || type === 'string') {
            classNames.push(type);
        } else if (!isNaN(+value)) {
            classNames.push('number');
        } else if (VariableItem.booleanRegex.test(value)) {
            classNames.push('boolean');
        } else if (VariableItem.stringRegex.test(value)) {
            classNames.push('string');
        }
        return classNames.join(' ');
    }

}

export class VirtualVariableItem extends ExpressionContainer {

    constructor(
        protected readonly options: VirtualVariableItem.Options
    ) {
        super(options);
    }

    render(): React.ReactNode {
        return this.options.name;
    }
}
export namespace VirtualVariableItem {
    export interface Options extends ExpressionContainer.Options {
        name: string
    }
}

export class ExpressionItem extends ExpressionContainer {

    static notAvailable = 'not available';

    protected value = ExpressionItem.notAvailable;
    protected available = false;

    constructor(
        protected readonly expression: string,
        protected readonly session: DebugSession | undefined
    ) {
        super({ connection: session && session['connection'] });
    }

    render(): React.ReactNode {
        const valueClassNames: string[] = [];
        if (!this.available) {
            valueClassNames.push(ConsoleItem.errorClassName);
            valueClassNames.push('theia-debug-console-unavailable');
        }
        return <div className={'theia-debug-console-expression'}>
            <div>{this.expression}</div>
            <div className={valueClassNames.join(' ')}>{this.value}</div>
        </div>;
    }

    async evaluate(): Promise<void> {
        if (this.session) {
            try {
                const { expression } = this;
                const body = await this.session.evaluate(expression, 'repl');
                if (body) {
                    this.value = body.result;
                    this.available = true;
                    this.variablesReference = body.variablesReference;
                    this.namedVariables = body.namedVariables;
                    this.indexedVariables = body.indexedVariables;
                    this.items = undefined;
                }
            } catch (err) {
                this.value = err.message;
                this.available = false;
            }
        } else {
            this.value = 'Please start a debug session to evaluate';
            this.available = false;
        }
    }

}

export class DebugScope extends ExpressionContainer {

    constructor(
        protected readonly raw: DebugProtocol.Scope,
        protected readonly connection: DebugSessionConnection
    ) {
        super({
            connection,
            variablesReference: raw.variablesReference,
            namedVariables: raw.namedVariables,
            indexedVariables: raw.indexedVariables
        });
    }

    render(): React.ReactNode {
        return this.raw.name;
    }

}
