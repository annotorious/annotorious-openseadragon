import axios from 'axios';
import React from 'react';
import ReactDOM from 'react-dom';
import OpenSeadragonAnnotator from './OpenSeadragonAnnotator';
import { WebAnnotation } from '@recogito/recogito-client-core';

import '@recogito/recogito-client-core/themes/default';

export class AnnotoriousOSD {

  constructor(viewer) {
    this._app = React.createRef();

    const viewerEl = viewer.element;
    if (!viewerEl.style.position)
      viewerEl.style.position = 'relative';

    this.appContainerEl = document.createElement('DIV');
    viewerEl.appendChild(this.appContainerEl);

    ReactDOM.render(
      <OpenSeadragonAnnotator 
        ref={this._app}
        wrapperEl={viewerEl} 
        viewer={viewer} />, this.appContainerEl);
  }

  loadAnnotations = url => axios.get(url).then(response => {
    const annotations = response.data.map(a => new WebAnnotation(a));
    this._app.current.setAnnotations(annotations);
    return annotations;
  });

}

export const init = (osdEl, viewer) => new AnnotoriousOSD(osdEl, viewer);
