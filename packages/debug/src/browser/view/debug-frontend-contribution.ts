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

import {
    ApplicationShell,
    WidgetManager,
    FrontendApplicationContribution,
    BaseWidget,
    PanelLayout,
    Message
} from '@theia/core/lib/browser';
import { DebugSessionManager } from '../debug-session-manager';
import { DebugSession } from '../debug-session';
import { inject, injectable, postConstruct } from 'inversify';
import { DebugThreadsWidget } from './debug-threads-widget';
import { DebugStackFramesWidget } from './debug-stack-frames-widget';
import { DebugBreakpointsWidget } from './debug-breakpoints-widget';
import { DebugStyles } from './base/debug-styles';
import { DebugToolBar } from './debug-toolbar-widget';
import { ViewContainer } from '@theia/core/lib/browser/view-container';

// FIXME
import { ConsoleContentWidget } from '@theia/console/lib/browser/content/console-content-widget';
import { DebugVariablesSource } from '../view/debug-variables-source';
import { ConsoleSessionNode } from '@theia/console/lib/browser/content/console-content-tree';

export const DEBUG_FACTORY_ID = 'debug';

/**
 * The debug target widget. It is used as a container
 * for the rest of widgets for the specific debug target.
 */
@injectable()
export class DebugWidget extends BaseWidget {
    // private readonly HORIZONTALS_IDS = ['theia-bottom-content-panel', 'theia-main-content-panel'];

    @inject(DebugSessionManager) protected readonly debugSessionManager: DebugSessionManager;
    @inject(DebugSession) protected readonly session: DebugSession;
    @inject(DebugThreadsWidget) protected readonly threads: DebugThreadsWidget;
    @inject(DebugStackFramesWidget) protected readonly frames: DebugStackFramesWidget;
    @inject(DebugBreakpointsWidget) protected readonly breakpoints: DebugBreakpointsWidget;
    @inject(DebugToolBar) protected readonly toolbar: DebugToolBar;

    @inject(ConsoleContentWidget)
    protected readonly variables: ConsoleContentWidget; // FIXME extract reusable tree data source
    @inject(DebugVariablesSource)
    protected readonly variablesSource: DebugVariablesSource;

    @postConstruct()
    protected init(): void {
        this.id = `debug-panel-${this.session.sessionId}`;
        this.title.label = this.session.configuration.name;
        this.title.caption = this.session.configuration.name;
        this.title.closable = true;
        this.title.iconClass = 'fa debug-tab-icon';
        this.addClass(DebugStyles.DEBUG_CONTAINER);

        const layout = this.layout = new PanelLayout();
        layout.addWidget(this.toolbar);

        this.variables.id = 'debug:variables:' + this.session.sessionId;
        this.variables.title.label = 'Variables';
        this.variables.model.root = ConsoleSessionNode.to(this.variablesSource);

        const debugContainer = new ViewContainer();
        debugContainer.addWidget(this.variables);
        debugContainer.addWidget(this.threads);
        debugContainer.addWidget(this.frames);
        debugContainer.addWidget(this.breakpoints);
        layout.addWidget(debugContainer);
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.toolbar.focus();
    }

}

@injectable()
export class DebugFrontendContribution implements FrontendApplicationContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(WidgetManager) protected readonly widgetManager: WidgetManager;
    @inject(DebugSessionManager) protected readonly debugSessionManager: DebugSessionManager;

    @postConstruct()
    protected init() {
        this.debugSessionManager.onDidCreateDebugSession(debugSession => this.onDebugSessionCreated(debugSession));
        this.debugSessionManager.onDidDestroyDebugSession(debugSession => this.onDebugSessionDestroyed(debugSession));
        this.debugSessionManager.findAll().forEach(debugSession => this.createDebugWidget(debugSession));
    }

    initialize(): void { }

    private async onDebugSessionCreated(debugSession: DebugSession): Promise<void> {
        this.createDebugWidget(debugSession);
    }

    private async onDebugSessionDestroyed(debugSession: DebugSession): Promise<void> { }

    private async createDebugWidget(debugSession: DebugSession): Promise<void> {
        const { sessionId } = debugSession;
        const options: DebugWidgetOptions = { sessionId };
        const widget = <DebugWidget>await this.widgetManager.getOrCreateWidget(DEBUG_FACTORY_ID, options);

        const tabBar = this.shell.getTabBarFor(widget);
        if (!tabBar) {
            this.shell.addWidget(widget, { area: 'left' });
        }
        this.shell.activateWidget(widget.id);
    }
}

/**
 * Debug widget options. (JSON)
 */
export const DebugWidgetOptions = Symbol('DebugWidgetOptions');
export interface DebugWidgetOptions {
    /**
     * Debug session.
     */
    readonly sessionId: string;
}
