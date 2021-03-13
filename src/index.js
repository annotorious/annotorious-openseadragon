import axios from 'axios';
import React from 'react';
import ReactDOM from 'react-dom';
import Emitter from 'tiny-emitter';
import OpenSeadragonAnnotator from './OpenSeadragonAnnotator';
import { 
  WebAnnotation, 
  Selection,
  createEnvironment,
  setLocale 
} from '@recogito/recogito-client-core';

import '@recogito/annotorious/src/ImageAnnotator.scss';
import '@recogito/recogito-client-core/themes/default';

class OSDAnnotorious {

  constructor(viewer, conf) {
    const config = conf || {};

    this._app = React.createRef();
    
    this._emitter = new Emitter();

    this._env = createEnvironment();

    const viewerEl = viewer.element;

    if (!viewerEl.style.position)
      viewerEl.style.position = 'relative';

    setLocale(config.locale);

    this.appContainerEl = document.createElement('DIV');

    viewerEl.appendChild(this.appContainerEl);
    
    ReactDOM.render(
      <OpenSeadragonAnnotator 
        ref={this._app}
        viewer={viewer} 
        wrapperEl={viewerEl}
        config={config} 
        env={this._env}
        onSelectionCreated={this.handleSelectionCreated}
        onSelectionTargetChanged={this.handleSelectionTargetChanged}
        onAnnotationSelected={this.handleAnnotationSelected}
        onAnnotationCreated={this.handleAnnotationCreated} 
        onAnnotationUpdated={this.handleAnnotationUpdated} 
        onAnnotationDeleted={this.handleAnnotationDeleted}
        onMouseEnterAnnotation={this.handleMouseEnterAnnotation}
        onMouseLeaveAnnotation={this.handleMouseLeaveAnnotation} 
        onSelectionCanceled={this.handleSelectionCanceled} />, this.appContainerEl);
  }

  /********************/               
  /*  External events */
  /********************/  

  handleAnnotationCreated = (annotation, overrideId) =>
    this._emitter.emit('createAnnotation', annotation.underlying, overrideId);

  handleAnnotationDeleted = annotation =>
    this._emitter.emit('deleteAnnotation', annotation.underlying);

  handleAnnotationSelected = annotation => 
    this._emitter.emit('selectAnnotation', annotation.underlying);

  handleAnnotationUpdated = (annotation, previous) =>
    this._emitter.emit('updateAnnotation', annotation.underlying, previous.underlying);

  handleSelectionCreated = selection =>
    this._emitter.emit('createSelection', selection.underlying);

  handleSelectionTargetChanged = target =>
    this._emitter.emit('changeSelectionTarget', target);

  handleSelectionCanceled = annotation =>
    this._emitter.emit('cancelSelection', annotation.underlying);

  handleMouseEnterAnnotation = (annotation, evt) =>
    this._emitter.emit('mouseEnterAnnotation', annotation.underlying, evt);

  handleMouseLeaveAnnotation = (annotation, evt) =>
    this._emitter.emit('mouseLeaveAnnotation', annotation.underlying, evt);

  /********************/               
  /*  External API    */
  /********************/  

  // Common shorthand for handling annotationOrId args
  _wrap = annotationOrId =>
    annotationOrId?.type === 'Annotation' ? new WebAnnotation(annotationOrId) : annotationOrId;

  addAnnotation = annotation =>
    this._app.current.addAnnotation(new WebAnnotation(annotation));

  cancelSelected = () =>
    this._app.current.cancelSelected();

  clearAnnotations = () =>
    this.setAnnotations([]);

  clearAuthInfo = () =>
    this._env.user = null;
  
  destroy = () =>
    ReactDOM.unmountComponentAtNode(this.appContainerEl);

  fitBounds = (annotationOrId, immediately) =>
    this._app.current.fitBounds(this._wrap(annotationOrId), immediately);

  getAnnotations = () => {
    const annotations = this._app.current.getAnnotations();
    return annotations.map(a => a.underlying);
  }

  getSelected = () => {
    const selected = this._app.current.getSelected();
    return selected?.underlying;
  }
  
  getSelectedImageSnippet = () =>
    this._app.current.getSelectedImageSnippet();

  loadAnnotations = url => axios.get(url).then(response => {
    const annotations = response.data;
    this.setAnnotations(annotations);
    return annotations;
  });

  off = (event, callback) =>
    this._emitter.off(event, callback);

  on = (event, handler) =>
    this._emitter.on(event, handler);

  panTo = (annotationOrId, immediately) =>
    this._app.current.panTo(this._wrap(annotationOrId), immediately);

  removeAnnotation = annotation =>
    this._app.current.removeAnnotation(new WebAnnotation(annotation));

  selectAnnotation = annotationOrId => {
    const selected = this._app.current.selectAnnotation(this._wrap(annotationOrId));
    return selected?.underlying;
  }
  
  setAnnotations = annotations => {
    const safe = annotations || []; // Allow null for clearning all current annotations
    const webannotations = safe.map(a => new WebAnnotation(a));
    this._app.current.setAnnotations(webannotations);
  }

  setAuthInfo = authinfo =>
    this._env.user = authinfo;

  setDrawingEnabled = enable =>
    this._app.current.setDrawingEnabled(enable);

  setDrawingTool = shape =>
    this._app.current.setDrawingTool(shape);

  setVisible = visible =>
    this._app.current.setVisible(visible); 

  setServerTime = timestamp => 
    this._env.setServerTime(timestamp);

  updateSelected = annotation => {
    let updated = null;

    if (annotation.type === 'Annotation') {
      updated = new WebAnnotation(annotation);
    } else if (annotation.type === 'Selection') {
      updated = new Selection(annotation.target, annotation.body);
    }
    
    if (updated)
      this._app.current.updateSelected(updated);
  }

}

export default (viewer, config) =>
  new OSDAnnotorious(viewer, config); 
