/********************************************************************************
 * Copyright (C) 2018 Red Hat, Inc. and others.
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

import { VirtualWidget, SELECTED_CLASS, ContextMenuRenderer } from '@theia/core/lib/browser';
import { h } from '@phosphor/virtualdom';
import { injectable, inject, postConstruct } from 'inversify';
import { DEBUG_SESSION_THREAD_CONTEXT_MENU } from '../debug-command';
import { DebugSession } from '../debug-session';

@injectable()
export class DebugThreadsWidget extends VirtualWidget {

    @inject(DebugSession)
    protected readonly session: DebugSession;

    @inject(ContextMenuRenderer)
    protected readonly contextMenuRenderer: ContextMenuRenderer;

    @postConstruct()
    protected init(): void {
        this.id = 'debug-threads-' + this.session.sessionId;
        this.title.label = 'Threads';
        this.addClass('theia-debug-entry');
        this.session.onDidChange(() => this.update());
    }

    protected render(): h.Child {
        const items: h.Child = [];

        for (const thread of this.session.threads) {
            const classNames = ['theia-debug-threads'];
            if (this.session.currentThread === thread) {
                classNames.push(SELECTED_CLASS);
            }
            const className = classNames.join(' ');
            const id = String(thread.raw.id);

            const item =
                h.div({
                    id, className,
                    onclick: () => this.session.currentThread = thread,
                    oncontextmenu: event => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.session.currentThread = thread;
                        this.contextMenuRenderer.render(DEBUG_SESSION_THREAD_CONTEXT_MENU, event);
                    }
                }, thread.raw.name);
            items.push(item);
        }

        return items;
    }
}
