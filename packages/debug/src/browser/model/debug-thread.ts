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

import { Event, Emitter } from '@theia/core';
import { DebugProtocol } from 'vscode-debugprotocol/lib/debugProtocol';
import { DebugSessionConnection } from '../debug-session-connection';
import { DebugStackFrame } from './debug-stack-frame';
import debounce = require('p-debounce');

export enum DebugState {
    Inactive,
    Running,
    Stopped
}

export type StoppedDetails = DebugProtocol.StoppedEvent['body'] & {
    framesErrorMessage?: string
};

export class DebugThreadData {
    readonly raw: DebugProtocol.Thread;
    readonly stoppedDetails: StoppedDetails | undefined;
}

export class DebugThread extends DebugThreadData {

    protected readonly onDidChangedEmitter = new Emitter<void>();
    readonly onDidChanged: Event<void> = this.onDidChangedEmitter.event;

    constructor(
        protected readonly connnection: DebugSessionConnection
    ) {
        super();
    }

    protected _currentFrame: DebugStackFrame | undefined;
    get currentFrame(): DebugStackFrame | undefined {
        return this._currentFrame;
    }
    set currentFrame(frame: DebugStackFrame | undefined) {
        this.setCurrentFrame(frame);
    }

    get state(): DebugState {
        return this.stoppedDetails !== undefined ? DebugState.Stopped : DebugState.Running;
    }

    update(data: Partial<DebugThreadData>): void {
        Object.assign(this, data);
    }

    clear(): void {
        this.update({
            raw: this.raw,
            stoppedDetails: undefined
        });
        this.updateFrames([]);
    }

    continue(): Promise<DebugProtocol.ContinueResponse> {
        return this.connnection.sendRequest('continue', this.toArgs());
    }

    next(): Promise<DebugProtocol.NextResponse> {
        return this.connnection.sendRequest('next', this.toArgs());
    }

    stepIn(): Promise<DebugProtocol.StepInResponse> {
        return this.connnection.sendRequest('stepIn', this.toArgs());
    }

    stepOut(): Promise<DebugProtocol.StepOutResponse> {
        return this.connnection.sendRequest('stepOut', this.toArgs());
    }

    pause(): Promise<DebugProtocol.PauseResponse> {
        return this.connnection.sendRequest('pause', this.toArgs());
    }

    protected _frames = new Map<number, DebugStackFrame>();
    get frames(): IterableIterator<DebugStackFrame> {
        return this._frames.values();
    }

    readonly resolve = debounce(async () => {
        const frames = await this.fetchFrames();
        this.updateFrames(frames);
    }, 100);
    protected async fetchFrames(): Promise<DebugProtocol.StackFrame[]> {
        try {
            const response = await this.connnection.sendRequest('stackTrace', this.toArgs<Partial<DebugProtocol.StackTraceArguments>>({
                format: {
                    parameters: true,
                    parameterTypes: true,
                    parameterNames: true,
                    parameterValues: true,
                    line: true,
                    module: true,
                    includeAll: true,
                    hex: false
                }
            }));
            return response.body.stackFrames;
        } catch (e) {
            if (this.stoppedDetails) {
                this.stoppedDetails.framesErrorMessage = e.message;
            }
            return [];
        }
    }
    protected updateFrames(frames: DebugProtocol.StackFrame[]): void {
        const existing = this._frames;
        this._frames = new Map();
        for (const raw of frames) {
            const id = raw.id;
            const frame = existing.get(id) || new DebugStackFrame(this.connnection);
            this._frames.set(id, frame);
            frame.update({ raw });
        }
        this.updateCurrentFrame();
    }
    protected updateCurrentFrame(): void {
        const { currentFrame } = this;
        const frameId = currentFrame && currentFrame.raw.id;
        this.setCurrentFrame(typeof frameId === 'number' &&
            this._frames.get(frameId) ||
            this._frames.values().next().value);
    }

    protected toArgs<T extends object>(arg?: T): { threadId: number } & T {
        return Object.assign({}, arg, {
            threadId: this.raw.id
        });
    }

    protected async setCurrentFrame(frame: DebugStackFrame | undefined): Promise<void> {
        this._currentFrame = frame;
        this.onDidChangedEmitter.fire(undefined);
    }

}
