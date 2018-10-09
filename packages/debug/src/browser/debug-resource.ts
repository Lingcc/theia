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

import { injectable, inject } from 'inversify';
import { Resource, ResourceResolver } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { DebugSessionManager } from './debug-session-manager';
import { DebugSession } from './debug-session';

/**
 * DAP resource.
 */
export const DAP_SCHEME = 'dap';

export class DebugResource implements Resource {

    constructor(
        public uri: URI,
        protected readonly debugSessionManager: DebugSessionManager
    ) { }

    dispose(): void { }

    readContents(options: { encoding?: string }): Promise<string> {
        const session = this.debugSessionManager.currentSession;
        if (!session) {
            throw new Error(`There is no active debug session to load content '${this.uri}'`);
        }

        const sourceReference = this.uri.query;
        if (sourceReference) {
            return this.source(session, Number(sourceReference));
        }

        const path = this.uri.path.toString();
        const source = session.sources.get(path);
        if (!source) {
            throw new Error(`There is no loaded source for '${this.uri}'`);
        }

        if (!source.sourceReference) {
            throw new Error(`sourceReference isn't specified '${this.uri}'`);
        }

        return this.source(session, source.sourceReference);
    }

    protected async source(session: DebugSession, sourceReference: number): Promise<string> {
        // FIXME hide session.run
        const response = await session.run('source', { sourceReference });
        return response.body.content;
    }
}

@injectable()
export class DebugResourceResolver implements ResourceResolver {

    @inject(DebugSessionManager)
    protected readonly debugSessionManager: DebugSessionManager;

    resolve(uri: URI): DebugResource {
        if (uri.scheme !== DAP_SCHEME) {
            throw new Error('The given URI is not a valid dap uri: ' + uri);
        }
        return new DebugResource(uri, this.debugSessionManager);
    }

}
