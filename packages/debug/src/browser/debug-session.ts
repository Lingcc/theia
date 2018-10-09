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

// tslint:disable:no-any

import { WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { DebugProtocol } from 'vscode-debugprotocol';
import { Emitter, Event, DisposableCollection, Disposable } from '@theia/core';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { DebugConfiguration } from '../common/debug-common';
import { DebugSessionConnection, DebugRequestTypes, DebugEventTypes } from './debug-session-connection';
import { DebugThread, StoppedDetails, DebugState } from './model/debug-thread';
import { DebugStackFrame } from './model/debug-stack-frame';
import debounce = require('p-debounce');

/**
 * Initialize requests arguments.
 */
export const INITIALIZE_ARGUMENTS = {
    clientID: 'Theia',
    clientName: 'Theia IDE',
    locale: 'en-US',
    linesStartAt1: true,
    columnsStartAt1: true,
    pathFormat: 'path',
    supportsVariableType: false,
    supportsVariablePaging: false,
    supportsRunInTerminalRequest: true
};

export class DebugSession {

    protected readonly connection: DebugSessionConnection;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected fireDidChange(): void {
        this.onDidChangeEmitter.fire(undefined);
    }

    protected readonly onConfigurationDoneEmitter = new Emitter<DebugProtocol.ConfigurationDoneResponse>();
    readonly onConfigurationDone: Event<DebugProtocol.ConfigurationDoneResponse> = this.onConfigurationDoneEmitter.event;

    protected readonly toDispose = new DisposableCollection(
        this.onDidChangeEmitter,
        this.onConfigurationDoneEmitter
    );

    constructor(
        public readonly sessionId: string,
        public readonly configuration: DebugConfiguration,
        connectionProvider: WebSocketConnectionProvider,
        protected readonly terminalServer: TerminalService
    ) {
        this.toDispose.push(this.connection = new DebugSessionConnection(sessionId, connectionProvider));
        this.connection.onRequest('runInTerminal', (request: DebugProtocol.RunInTerminalRequest) => this.runInTerminal(request));
        this.toDispose.pushAll([
            this.onConfigurationDone(() => this.resolveThreads(undefined)),
            this.on('continued', ({ body: { allThreadsContinued, threadId } }) => {
                if (allThreadsContinued !== false) {
                    this.clearThreads();
                } else {
                    this.clearThread(threadId);
                }
            }),
            this.on('stopped', ({ body }) => this.resolveThreads(body)),
            this.on('thread', ({ body: { reason, threadId } }) => {
                if (reason === 'started') {
                    this.resolveThreads(undefined);
                } else if (reason === 'exited') {
                    this.clearThread(threadId);
                }
            }),
            // TODO remove thread on termination?
            this.on('loadedSource', event => this.updateSources(event)),
            this.on('capabilities', event => this.updateCapabilities(event.body.capabilities))
        ]);

    }

    allThreadsContinued = false;
    allThreadsStopped = false;
    capabilities: DebugProtocol.Capabilities = {};
    readonly sources = new Map<string, DebugProtocol.Source>();

    protected _threads = new Map<number, DebugThread>();
    get threads(): IterableIterator<DebugThread> {
        return this._threads.values();
    }
    hasThreadsForState(state: DebugState): boolean {
        return !!this.getThreadsForState(state).next().value;
    }
    getThreadsForState(state: DebugState): IterableIterator<DebugThread> {
        return this.getThreads(thread => thread.state === state);
    }
    *getThreads(filter: (thread: DebugThread) => boolean): IterableIterator<DebugThread> {
        for (const thread of this.threads) {
            if (filter(thread)) {
                yield thread;
            }
        }
    }

    get currentFrame(): DebugStackFrame | undefined {
        return this.currentThread && this.currentThread.currentFrame;
    }

    protected _currentThread: DebugThread | undefined;
    get currentThread(): DebugThread | undefined {
        return this._currentThread;
    }
    set currentThread(thread: DebugThread | undefined) {
        this.setCurrentThread(thread);
    }

    get state(): DebugState {
        const thread = this.currentThread;
        if (thread) {
            return thread.state;
        }
        return DebugState.Inactive;
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    async initialize(args: DebugProtocol.InitializeRequestArguments): Promise<DebugProtocol.InitializeResponse> {
        const response = await this.connection.sendRequest('initialize', args);
        this.capabilities = response.body || {};
        return response;
    }

    async pauseAll(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const thread of this.getThreadsForState(DebugState.Running)) {
            promises.push((async () => {
                try {
                    await thread.pause();
                } catch (e) {
                    console.error(e);
                }
            })());
        }
        await Promise.all(promises);
    }

    async continueAll(): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const thread of this.getThreadsForState(DebugState.Stopped)) {
            promises.push((async () => {
                try {
                    await thread.continue();
                } catch (e) {
                    console.error(e);
                }
            })());
        }
        await Promise.all(promises);
    }

    async configurationDone(): Promise<DebugProtocol.ConfigurationDoneResponse> {
        const response = await this.run('configurationDone', {});
        this.onConfigurationDoneEmitter.fire(response);
        return response;
    }

    async disconnect(args: DebugProtocol.DisconnectArguments = {}): Promise<void> {
        await this.run('disconnect', args);
    }

    async completions(text: string, column: number, line: number): Promise<DebugProtocol.CompletionItem[]> {
        const frameId = this.currentFrame && this.currentFrame.raw.id;
        const response = await this.run('completions', { frameId, text, column, line });
        return response.body.targets;
    }

    async evaluate(expression: string, context?: string): Promise<DebugProtocol.EvaluateResponse['body']> {
        const frameId = this.currentFrame && this.currentFrame.raw.id;
        const response = await this.run('evaluate', { expression, frameId, context });
        return response.body;
    }

    // FIXME hide it
    run<K extends keyof DebugRequestTypes>(command: K, args: DebugRequestTypes[K][0]): Promise<DebugRequestTypes[K][1]> {
        return this.connection.sendRequest(command, args);
    }

    on<K extends keyof DebugEventTypes>(kind: K, listener: (e: DebugEventTypes[K]) => any): Disposable {
        return this.connection.on(kind, listener);
    }
    onCustom<E extends DebugProtocol.Event>(kind: string, listener: (e: E) => any): Disposable {
        return this.connection.onCustom(kind, listener);
    }

    protected async runInTerminal({ arguments: { title, cwd, args, env } }: DebugProtocol.RunInTerminalRequest): Promise<DebugProtocol.RunInTerminalResponse['body']> {
        const terminal = await this.terminalServer.newTerminal({ title, cwd, shellPath: args[0], shellArgs: args.slice(1), env });
        this.terminalServer.activateTerminal(terminal);
        const processId = await terminal.start();
        return { processId };
    }

    protected clearThreads(): void {
        for (const thread of this.threads) {
            thread.clear();
        }
        this.updateCurrentThread();
    }
    protected clearThread(threadId: number): void {
        const thread = this._threads.get(threadId);
        if (thread) {
            thread.clear();
        }
        this.updateCurrentThread();
    }

    protected resolveThreads = debounce(async (stoppedDetails: StoppedDetails | undefined) => {
        const response = await this.run('threads', {});
        this.updateThreads(response.body.threads, stoppedDetails);
    }, 100);
    protected updateThreads(threads: DebugProtocol.Thread[], stoppedDetails?: StoppedDetails): void {
        const existing = this._threads;
        this._threads = new Map();
        for (const raw of threads) {
            const id = raw.id;
            const thread = existing.get(id) || new DebugThread(this.connection);
            this._threads.set(id, thread);
            thread.update({
                raw,
                stoppedDetails: stoppedDetails && stoppedDetails.threadId === id ? stoppedDetails : undefined
            });
        }
        this.updateCurrentThread(stoppedDetails);
    }

    protected updateCurrentThread(stoppedDetails?: StoppedDetails): void {
        const { currentThread } = this;
        let threadId = currentThread && currentThread.raw.id;
        if (stoppedDetails && !stoppedDetails.preserveFocusHint && !!stoppedDetails.threadId) {
            threadId = stoppedDetails.threadId;
        }
        this.setCurrentThread(typeof threadId === 'number' && this._threads.get(threadId)
            || this._threads.values().next().value);
    }

    protected setCurrentThread(thread: DebugThread | undefined): Promise<void> {
        return this.doSetCurrentThread(thread && thread.state === DebugState.Stopped ? thread : undefined);
    }
    protected readonly toDisposeOnCurrentThread = new DisposableCollection();
    protected async doSetCurrentThread(thread: DebugThread | undefined): Promise<void> {
        this.toDisposeOnCurrentThread.dispose();
        this._currentThread = thread;
        this.fireDidChange();
        if (thread) {
            this.toDisposeOnCurrentThread.push(thread.onDidChanged(() => this.fireDidChange()));
            await thread.resolve();
        }
    }

    protected updateSources(event: DebugProtocol.LoadedSourceEvent): void {
        const source = event.body.source;
        switch (event.body.reason) {
            case 'new':
            case 'changed': {
                if (source.path) {
                    this.sources.set(source.path, source);
                } if (source.sourceReference) {
                    this.sources.set(source.sourceReference.toString(), source);
                }

                break;
            }
        }
    }

    protected updateCapabilities(capabilities: DebugProtocol.Capabilities): void {
        Object.assign(this.capabilities, capabilities);
    }

}
