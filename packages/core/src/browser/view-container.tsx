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

import * as React from 'react';
import { ReactWidget, Widget, EXPANSION_TOGGLE_CLASS, COLLAPSED_CLASS } from './widgets';
import { Disposable } from '../common/disposable';

export class ViewContainer extends ReactWidget {

    protected readonly widgets = new Set<Widget>();

    constructor() {
        super();
        this.addClass('theia-view-container');
    }

    protected render(): React.ReactNode {
        const parts: React.ReactNode[] = [];
        this.widgets.forEach(widget => parts.push(this.renderPart(widget)));
        return <React.Fragment>{parts}</React.Fragment>;
    }

    protected renderPart(widget: Widget): React.ReactNode {
        return <ViewContainerPart key={widget.id} widget={widget} />;
    }

    addWidget(widget: Widget): Disposable {
        if (this.widgets.has(widget)) {
            return Disposable.NULL;
        }
        this.widgets.add(widget);
        this.update();
        return Disposable.create(() => this.removeWidget(widget));
    }

    removeWidget(widget: Widget): boolean {
        if (!this.widgets.delete(widget)) {
            return false;
        }
        this.update();
        return true;
    }

}

export class ViewContainerPart extends React.Component<ViewContainerPart.Props, ViewContainerPart.State> {

    constructor(props: ViewContainerPart.Props) {
        super(props);
        this.state = {
            expanded: true
        };
    }

    render(): React.ReactNode {
        const { widget } = this.props;
        const toggleClassNames = [EXPANSION_TOGGLE_CLASS];
        if (!this.state.expanded) {
            toggleClassNames.push(COLLAPSED_CLASS);
        }
        const toggleClassName = toggleClassNames.join(' ');
        return <div>
            <div className='theia-header view-container-part-header'
                title={widget.title.caption}
                onClick={this.toggle}>
                <span className={toggleClassName} />{widget.title.label}</div>
            {this.state.expanded && <div ref={this.setRef}></div>}
        </div>;
    }

    protected toggle = () => {
        if (this.state.expanded) {
            Widget.detach(this.props.widget);
        }
        this.setState({
            expanded: !this.state.expanded
        });
    }

    protected ref: HTMLElement | undefined;
    protected setRef = (ref: HTMLElement | null) => {
        const { widget } = this.props;
        if (ref) {
            Widget.attach(widget, ref);
        }
    }

}
export namespace ViewContainerPart {
    export interface Props {
        widget: Widget
    }
    export interface State {
        expanded: boolean
    }
}
