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

import { injectable, inject, named, postConstruct } from 'inversify';
import { DebugConfiguration, DebugService } from '../common/debug-common';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Emitter, Event, ContributionProvider } from '@theia/core';
import { BreakpointsApplier } from './breakpoint/breakpoint-applier';
import { NotificationsMessageClient } from '@theia/messages/lib/browser/notifications-message-client';
import { MessageType } from '@theia/core/lib/common/message-service-protocol';
import { DebugSession, INITIALIZE_ARGUMENTS } from './debug-session';
import { DebugSessionContribution, DebugSessionFactory } from './debug-session-contribution';
import { DebugThread, DebugState } from './model/debug-thread';
import { DebugStackFrame } from './model/debug-stack-frame';

@injectable()
export class DebugSessionManager {
    private activeDebugSessionId: string | undefined;

    protected readonly sessions = new Map<string, DebugSession>();
    protected readonly contribs = new Map<string, DebugSessionContribution>();
    protected readonly onDidPreCreateDebugSessionEmitter = new Emitter<string>();
    protected readonly onDidCreateDebugSessionEmitter = new Emitter<DebugSession>();
    protected readonly onDidChangeActiveDebugSessionEmitter = new Emitter<[DebugSession | undefined, DebugSession | undefined]>();
    protected readonly onDidDestroyDebugSessionEmitter = new Emitter<DebugSession>();

    @inject(DebugSessionFactory) protected readonly debugSessionFactory: DebugSessionFactory;
    @inject(ContributionProvider) @named(DebugSessionContribution) protected readonly contributions: ContributionProvider<DebugSessionContribution>;
    @inject(BreakpointsApplier) protected readonly breakpointApplier: BreakpointsApplier;
    @inject(DebugService) protected readonly debugService: DebugService;
    @inject(NotificationsMessageClient) protected readonly notification: NotificationsMessageClient;

    @postConstruct()
    protected init(): void {
        for (const contrib of this.contributions.getContributions()) {
            this.contribs.set(contrib.debugType, contrib);
        }
    }

    /**
     * Creates a new [debug session](#DebugSession).
     * @param sessionId The session identifier
     * @param configuration The debug configuration
     * @returns The debug session
     */
    async create(sessionId: string, debugConfiguration: DebugConfiguration): Promise<DebugSession> {
        this.onDidPreCreateDebugSessionEmitter.fire(sessionId);

        const contrib = this.contribs.get(debugConfiguration.type);
        const sessionFactory = contrib ? contrib.debugSessionFactory() : this.debugSessionFactory;
        const session = sessionFactory.get(sessionId, debugConfiguration);
        this.sessions.set(sessionId, session);

        this.onDidCreateDebugSessionEmitter.fire(session);

        session.on('initialized', () => this.onSessionInitialized(session));
        session.on('terminated', event => this.disconnect(session, event));
        session.on('exited', () => this.destroy(session.sessionId));
        this.launchOrAttach(session);
        return session;
    }

    protected disconnect(session: DebugSession, event: DebugProtocol.TerminatedEvent): void {
        const restart = event.body && event.body.restart;
        if (restart) {
            this.restart(session, restart);
        } else {
            session.disconnect();
        }
    }

    protected async restart(session: DebugSession, restart: Object): Promise<void> {
        await session.disconnect({ restart: true });
        await this.launchOrAttach(session);
    }

    protected async launchOrAttach(session: DebugSession): Promise<void> {
        const initializeArgs: DebugProtocol.InitializeRequestArguments = {
            ...INITIALIZE_ARGUMENTS,
            adapterID: session.configuration.type
        };
        const request = session.configuration.request;
        switch (request) {
            case 'attach': {
                await this.attach(session, initializeArgs);
                break;
            }
            case 'launch': {
                await this.launch(session, initializeArgs);
                break;
            }
            default: throw new Error(`Unsupported request '${request}' type.`);
        }
    }

    private async attach(session: DebugSession, initializeArgs: DebugProtocol.InitializeRequestArguments): Promise<void> {
        await session.initialize(initializeArgs);

        const attachArgs: DebugProtocol.AttachRequestArguments = Object.assign(session.configuration, { __restart: false });
        try {
            await session.run('attach', attachArgs);
        } catch (cause) {
            this.onSessionInitializationFailed(session, cause as DebugProtocol.Response);
            throw cause;
        }
    }

    private async launch(session: DebugSession, initializeArgs: DebugProtocol.InitializeRequestArguments): Promise<void> {
        await session.initialize(initializeArgs);

        const launchArgs: DebugProtocol.LaunchRequestArguments = Object.assign(session.configuration, { __restart: false, noDebug: false });
        try {
            await session.run('launch', launchArgs);
        } catch (cause) {
            this.onSessionInitializationFailed(session, cause as DebugProtocol.Response);
            throw cause;
        }
    }

    private async onSessionInitialized(session: DebugSession): Promise<void> {
        await this.breakpointApplier.applySessionBreakpoints(session);
        await session.configurationDone();
    }

    private async onSessionInitializationFailed(session: DebugSession, cause: DebugProtocol.Response): Promise<void> {
        this.destroy(session.sessionId);
        await this.notification.showMessage({
            type: MessageType.Error,
            text: cause.message || 'Debug session initialization failed. See console for details.',
            options: {
                timeout: 10000
            }
        });
    }

    /**
     * Removes the [debug session](#DebugSession).
     * @param sessionId The session identifier
     */
    remove(sessionId: string): void {
        this.sessions.delete(sessionId);
        if (this.activeDebugSessionId) {
            if (this.activeDebugSessionId === sessionId) {
                if (this.sessions.size !== 0) {
                    this.setActiveDebugSession(this.sessions.keys().next().value);
                } else {
                    this.setActiveDebugSession(undefined);
                }
            }
        }
    }

    /**
     * Finds a debug session by its identifier.
     * @returns The debug sessions
     */
    find(sessionId: string): DebugSession | undefined {
        return this.sessions.get(sessionId);
    }

    /**
     * Finds all instantiated debug sessions.
     * @returns An array of debug sessions
     */
    findAll(): DebugSession[] {
        return Array.from(this.sessions.values());
    }

    /**
     * Sets the active debug session.
     * @param sessionId The session identifier
     */
    setActiveDebugSession(sessionId: string | undefined) {
        if (sessionId && this.find(sessionId) === undefined) {
            return;
        }

        const oldActiveSessionSession = this.activeDebugSessionId ? this.find(this.activeDebugSessionId) : undefined;

        if (this.activeDebugSessionId !== sessionId) {
            this.activeDebugSessionId = sessionId;
            this.onDidChangeActiveDebugSessionEmitter.fire([oldActiveSessionSession, this.currentSession]);
        }
    }

    get currentSession(): DebugSession | undefined {
        if (this.activeDebugSessionId) {
            return this.sessions.get(this.activeDebugSessionId);
        }
        return undefined;
    }

    get currentThread(): DebugThread | undefined {
        const session = this.currentSession;
        return session && session.currentThread;
    }

    get state(): DebugState {
        const session = this.currentSession;
        return session ? session.state : DebugState.Inactive;
    }

    get currentFrame(): DebugStackFrame | undefined {
        const { currentThread } = this;
        return currentThread && currentThread.currentFrame;
    }

    /**
     * Destroy the debug session. If session identifier isn't provided then
     * all active debug session will be destroyed.
     * @param sessionId The session identifier
     */
    destroy(sessionId?: string): void {
        if (sessionId) {
            const session = this.sessions.get(sessionId);
            if (session) {
                this.doDestroy(session);
            }
        } else {
            this.sessions.forEach(session => this.doDestroy(session));
        }
    }

    private doDestroy(session: DebugSession): void {
        this.debugService.stop(session.sessionId);

        session.dispose();
        this.remove(session.sessionId);
        this.onDidDestroyDebugSessionEmitter.fire(session);
    }

    get onDidChangeActiveDebugSession(): Event<[DebugSession | undefined, DebugSession | undefined]> {
        return this.onDidChangeActiveDebugSessionEmitter.event;
    }

    get onDidPreCreateDebugSession(): Event<string> {
        return this.onDidPreCreateDebugSessionEmitter.event;
    }

    get onDidCreateDebugSession(): Event<DebugSession> {
        return this.onDidCreateDebugSessionEmitter.event;
    }

    get onDidDestroyDebugSession(): Event<DebugSession> {
        return this.onDidDestroyDebugSessionEmitter.event;
    }

}
