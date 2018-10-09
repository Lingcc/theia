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

import { ContainerModule, interfaces, Container } from 'inversify';
import { DebugCommandHandlers } from './debug-command';
import { DebugConfigurationManager } from './debug-configuration';
import {
    DEBUG_FACTORY_ID,
    DebugWidget,
    DebugFrontendContribution,
    DebugWidgetOptions,
} from './view/debug-frontend-contribution';
import { DebugPath, DebugService } from '../common/debug-common';
import { MenuContribution } from '@theia/core/lib/common/menu';
import { CommandContribution } from '@theia/core/lib/common/command';
import { WidgetFactory, WebSocketConnectionProvider, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { DebugSession } from './debug-session';
import { DebugSessionManager } from './debug-session-manager';
import { DebugResourceResolver } from './debug-resource';
import { DebugSessionContribution, DebugSessionFactory, DefaultDebugSessionFactory } from './debug-session-contribution';
import { DebugThreadsWidget } from './view/debug-threads-widget';
import { DebugStackFramesWidget } from './view/debug-stack-frames-widget';
import { DebugBreakpointsWidget, BreakpointsDialog } from './view/debug-breakpoints-widget';
import { bindContributionProvider, ResourceResolver } from '@theia/core';
import { ActiveLineDecorator, BreakpointDecorator } from './breakpoint/breakpoint-decorators';
import { BreakpointsManager } from './breakpoint/breakpoint-manager';
import { BreakpointStorage } from './breakpoint/breakpoint-marker';
import { SourceOpener } from './debug-utils';
import { BreakpointsApplier } from './breakpoint/breakpoint-applier';
import { DebugToolBar } from './view/debug-toolbar-widget';
import { DebugFrontendApplicationContribution } from './debug-frontend-application-contribution';
import { DebugConsoleContribution } from './console/debug-console-contribution';
import { ConsoleContentWidget } from '@theia/console/lib/browser/content/console-content-widget';
import { createDebugVariablesContainer } from './view/debug-variables-container';
import { DebugVariablesSource } from './view/debug-variables-source';

import '../../src/browser/style/index.css';

export default new ContainerModule((bind: interfaces.Bind, unbind: interfaces.Unbind, isBound: interfaces.IsBound, rebind: interfaces.Rebind) => {
    bindDebugSessionManager(bind);
    bindBreakpointsManager(bind);
    bindDebugWidget(bind);
    DebugConsoleContribution.bindContribution(bind);

    bind(MenuContribution).to(DebugCommandHandlers);
    bind(CommandContribution).to(DebugCommandHandlers);
    bind(DebugConfigurationManager).toSelf().inSingletonScope();

    bind(DebugService).toDynamicValue(context => WebSocketConnectionProvider.createProxy(context.container, DebugPath)).inSingletonScope();
    bind(DebugResourceResolver).toSelf().inSingletonScope();
    bind(ResourceResolver).toService(DebugResourceResolver);
    bind(FrontendApplicationContribution).to(DebugFrontendApplicationContribution).inSingletonScope();
});

function bindDebugWidget(bind: interfaces.Bind): void {
    bind(DebugWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: DEBUG_FACTORY_ID,
        createWidget: (options: DebugWidgetOptions) => {
            const container = createDebugTargetContainer(context, options.sessionId);
            return container.get<DebugWidget>(DebugWidget);
        }
    })).inSingletonScope();

    bind(DebugFrontendContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toDynamicValue(ctx => ctx.container.get(DebugFrontendContribution));
}

function bindBreakpointsManager(bind: interfaces.Bind): void {
    bind(BreakpointsDialog).toSelf().inSingletonScope();
    bind(ActiveLineDecorator).toSelf().inSingletonScope();
    bind(BreakpointDecorator).toSelf().inSingletonScope();
    bind(BreakpointStorage).toSelf().inSingletonScope();
    bind(BreakpointsApplier).toSelf().inSingletonScope();
    bind(BreakpointsManager).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toDynamicValue(ctx => ctx.container.get(BreakpointsManager));
    bind(SourceOpener).toSelf().inSingletonScope();
}

function bindDebugSessionManager(bind: interfaces.Bind): void {
    bindContributionProvider(bind, DebugSessionContribution);
    bind(DebugSessionFactory).to(DefaultDebugSessionFactory).inSingletonScope();
    bind(DebugSessionManager).toSelf().inSingletonScope();
}

function createDebugTargetContainer(context: interfaces.Context, sessionId: string): Container {
    const session = context.container.get(DebugSessionManager).find(sessionId);
    if (!session) {
        throw new Error(`Debug session '${sessionId}' does not exist`);
    }
    const child = new Container({ defaultScope: 'Singleton' });
    child.parent = context.container;

    child.bind(DebugSession).toConstantValue(session);
    child.bind(DebugThreadsWidget).toSelf();
    child.bind(DebugToolBar).toSelf();
    child.bind(DebugStackFramesWidget).toSelf();
    child.bind(DebugBreakpointsWidget).toSelf();
    child.bind(DebugVariablesSource).toSelf();
    child.bind(ConsoleContentWidget).toDynamicValue(({ container }) => createDebugVariablesContainer(container).get(ConsoleContentWidget));

    return child;
}
