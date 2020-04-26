import axios from 'axios';
import React from 'react';
import ReactDOM from 'react-dom';
import OpenSeadragonAnnotator from './OpenSeadragonAnnotator';
import { WebAnnotation } from '@recogito/recogito-client-core';

import '@recogito/recogito-client-core/themes/default';

/**
 * EXPERIMENTAL HACK!
 */
export class AnnotoriousOSD {

  constructor(osdEl, viewer) {
    this._app = React.createRef();

    const wrapperEl = document.createElement('DIV');
    wrapperEl.style.position = 'relative';
    wrapperEl.style.display = 'inline-block';
    osdEl.parentNode.insertBefore(wrapperEl, osdEl);
    wrapperEl.appendChild(osdEl);

    this.appContainerEl = document.createElement('DIV');
    wrapperEl.appendChild(this.appContainerEl);

    ReactDOM.render(
      <OpenSeadragonAnnotator 
        ref={this._app}
        wrapperEl={wrapperEl} 
        viewer={viewer} />, this.appContainerEl);
  }

  loadAnnotations = url => axios.get(url).then(response => {
    const annotations = response.data.map(a => new WebAnnotation(a));
    this._app.current.setAnnotations(annotations);
    return annotations;
  });

}

export const init = (osdEl, viewer) => new AnnotoriousOSD(osdEl, viewer);
