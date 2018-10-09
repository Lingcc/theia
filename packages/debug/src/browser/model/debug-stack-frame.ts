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

import { DebugProtocol } from 'vscode-debugprotocol/lib/debugProtocol';
import { DebugSessionConnection } from '../debug-session-connection';
import { DebugScope } from '../console/debug-console-items';

export class DebugStackFrameData {
    readonly raw: DebugProtocol.StackFrame;
}

export class DebugStackFrame extends DebugStackFrameData {

    constructor(
        protected readonly connection: DebugSessionConnection
    ) {
        super();
    }

    update(data: Partial<DebugStackFrameData>): void {
        Object.assign(this, data);
    }

    async reveal(): Promise<void> {
        if (!this.raw.source) {
            return;
        }
    }

    async resolveScopes(): Promise<DebugScope[]> {
        const response = await this.connection.sendRequest('scopes', this.toArgs());
        return response.body.scopes.map(raw => new DebugScope(raw, this.connection));
    }

    protected toArgs<T extends object>(arg?: T): { frameId: number } & T {
        return Object.assign({}, arg, {
            frameId: this.raw.id
        });
    }

}
