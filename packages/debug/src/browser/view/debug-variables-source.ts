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

import { injectable, inject, postConstruct } from 'inversify';
import { Event, Emitter } from '@theia/core/lib/common';
import { ConsoleSession, ConsoleItem } from '@theia/console/lib/browser/console-session';
import { DebugSession } from '../debug-session';
import debounce = require('p-debounce');

@injectable()
export class DebugVariablesSource implements ConsoleSession {

    id = 'Variables';
    name = 'Variables';
    items: ConsoleItem[] = [];
    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    @inject(DebugSession)
    protected readonly session: DebugSession;

    @postConstruct()
    protected init(): void {
        this.session.onDidChange(() => this.refresh());
    }

    protected readonly refresh = debounce(() => this.doRefresh(), 400);
    protected async doRefresh(): Promise<void> {
        if (!this.session.currentFrame) {
            return;
        }
        this.items = await this.session.currentFrame.resolveScopes();
        this.onDidChangeEmitter.fire(undefined);
    }

    execute(): void { /*no-op*/ }
    clear(): void { /*no-op*/ }

}
