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

import { PluginManagerExtImpl } from '../../plugin/plugin-manager';
import { MAIN_RPC_CONTEXT, Plugin, PluginAPIFactory } from '../../api/plugin-api';
import { PluginMetadata } from '../../common/plugin-protocol';
import { createAPIFactory } from '../../plugin/plugin-context';

/**
 * Handle the RPC calls.
 */
export class PluginHostRPC {

    private static apiFactory: PluginAPIFactory;

    private pluginManager: PluginManagerExtImpl;

    constructor(protected readonly rpc: any) {
    }

    initialize() {
        this.pluginManager = this.createPluginManager();
        this.rpc.set(MAIN_RPC_CONTEXT.HOSTED_PLUGIN_MANAGER_EXT, this.pluginManager);
        PluginHostRPC.apiFactory = createAPIFactory(this.rpc, this.pluginManager);
    }

    // tslint:disable-next-line:no-any
    static initialize(contextPath: string, plugin: Plugin): any {
        console.log('PLUGIN_HOST(' + process.pid + '): initializing(' + contextPath + ')');
        try {
            const backendInit = require(contextPath);
            backendInit.doInitialization(PluginHostRPC.apiFactory, plugin);
        } catch (e) {
            console.error(e);
        }
    }

    createPluginManager(): PluginManagerExtImpl {
        const pluginManager = new PluginManagerExtImpl({
            loadPlugin(plugin: Plugin): void {
                console.log('PLUGIN_HOST(' + process.pid + '): PluginManagerExtImpl/loadPlugin(' + plugin.pluginPath + ')');
                try {
                    return require(plugin.pluginPath);
                } catch (e) {
                    console.error(e);
                }
            },
            init(raw: PluginMetadata[]): [Plugin[], Plugin[]] {
                console.log('PLUGIN_HOST(' + process.pid + '): PluginManagerExtImpl/init()');
                const result: Plugin[] = [];
                const foreign: Plugin[] = [];
                for (const plg of raw) {
                    const pluginModel = plg.model;
                    const pluginLifecycle = plg.lifecycle;
                    if (pluginModel.entryPoint!.backend) {

                        let backendInitPath = pluginLifecycle.backendInitPath;
                        // if no init path, try to init as regular Theia plugin
                        if (!backendInitPath) {
                            backendInitPath = __dirname + '/scanners/backend-init-theia.js';
                        }

                        const plugin: Plugin = {
                            pluginPath: pluginModel.entryPoint.backend!,
                            pluginFolder: plg.source.packagePath,
                            model: pluginModel,
                            lifecycle: pluginLifecycle,
                            rawModel: plg.source
                        };

                        PluginHostRPC.initialize(backendInitPath, plugin);

                        result.push(plugin);
                    } else {
                        foreign.push({
                            pluginPath: pluginModel.entryPoint.frontend!,
                            pluginFolder: plg.source.packagePath,
                            model: pluginModel,
                            lifecycle: pluginLifecycle,
                            rawModel: plg.source
                        });
                    }
                }
                return [result, foreign];
            }
        });
        return pluginManager;
    }
}
