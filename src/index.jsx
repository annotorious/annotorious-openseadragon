import React from 'react';
import ReactDOM from 'react-dom';
import Emitter from 'tiny-emitter';
import OpenSeadragonAnnotator from './OpenSeadragonAnnotator';
import { 
  Selection,
  WebAnnotation,
  createEnvironment,
  setLocale
} from '@recogito/recogito-client-core';

import '@recogito/annotorious/src/ImageAnnotator.scss';
import '@recogito/recogito-client-core/themes/default';

class OSDAnnotorious {

  constructor(viewer, conf) {
    const config = conf || {};

    // TODO .headless option is deprecated!
    config.disableEditor = config.disableEditor || config.headless;

    this._app = React.createRef();
    
    this._emitter = new Emitter();

    this._env = createEnvironment();

    this._element = viewer.element;

    if (!this._element.style.position)
      this._element.style.position = 'relative';

    setLocale(config.locale, config.messages);

    this.appContainerEl = document.createElement('DIV');

    this._element.appendChild(this.appContainerEl);
    
    ReactDOM.render(
      <OpenSeadragonAnnotator 
        ref={this._app}
        viewer={viewer} 
        wrapperEl={this._element}
        config={config} 
        env={this._env}
        onSelectionStarted={this.handleSelectionStarted}
        onSelectionCreated={this.handleSelectionCreated}
        onSelectionTargetChanged={this.handleSelectionTargetChanged}
        onAnnotationCreated={this.handleAnnotationCreated} 
        onAnnotationSelected={this.handleAnnotationSelected}
        onAnnotationUpdated={this.handleAnnotationUpdated} 
        onAnnotationDeleted={this.handleAnnotationDeleted}
        onCancelSelected={this.handleCancelSelected}
        onClickAnnotation={this.handleClickAnnotation}
        onMouseEnterAnnotation={this.handleMouseEnterAnnotation}
        onMouseLeaveAnnotation={this.handleMouseLeaveAnnotation} />, this.appContainerEl);
  }

  /********************/               
  /*  External events */
  /********************/  

  handleAnnotationCreated = (annotation, overrideId) =>
    this._emitter.emit('createAnnotation', annotation.underlying, overrideId);

  handleAnnotationDeleted = annotation =>
    this._emitter.emit('deleteAnnotation', annotation.underlying);

  handleAnnotationSelected = (annotation, elem) => 
    this._emitter.emit('selectAnnotation', annotation.underlying, elem);

  handleAnnotationUpdated = (annotation, previous) =>
    this._emitter.emit('updateAnnotation', annotation.underlying, previous.underlying);

  handleCancelSelected = annotation =>
    this._emitter.emit('cancelSelected', annotation.underlying);

  handleClickAnnotation = (annotation, elem) =>
    this._emitter.emit('clickAnnotation', annotation.underlying, elem);
  
  handleSelectionCreated = selection =>
    this._emitter.emit('createSelection', selection.underlying);

  handleSelectionStarted = pt =>
    this._emitter.emit('startSelection', pt);

  handleSelectionTargetChanged = target =>
    this._emitter.emit('changeSelectionTarget', target);

  handleMouseEnterAnnotation = (annotation, elem) =>
    this._emitter.emit('mouseEnterAnnotation', annotation.underlying, elem);

  handleMouseLeaveAnnotation = (annotation, elem) =>
    this._emitter.emit('mouseLeaveAnnotation', annotation.underlying, elem);

  /********************/               
  /*  External API    */
  /********************/  

  // Common shorthand for handling annotationOrId args
  _wrap = annotationOrId =>
    annotationOrId?.type === 'Annotation' ? new WebAnnotation(annotationOrId) : annotationOrId;

  addAnnotation = annotation =>
    this._app.current.addAnnotation(new WebAnnotation(annotation));

  addDrawingTool = plugin =>
    this._app.current.addDrawingTool(plugin);

  cancelSelected = () =>
    this._app.current.cancelSelected();

  clearAnnotations = () =>
    this.setAnnotations([]);

  clearAuthInfo = () =>
    this._env.user = null;

  get disableEditor() {
    return this._app.current.disableEditor;
  }

  set disableEditor(disabled) {
    this._app.current.disableEditor = disabled;
  }

  get disableSelect() {
    return this._app.current.disableSelect;
  }

  set disableSelect(select) {
    this._app.current.disableSelect = select;
  }
  
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

  listDrawingTools = () =>
    this._app.current.listDrawingTools();

  loadAnnotations = url => fetch(url)
    .then(response => response.json()).then(annotations => {
      this.setAnnotations(annotations);
      return annotations;
    });

  off = (event, callback) =>
    this._emitter.off(event, callback);

  on = (event, handler) =>
    this._emitter.on(event, handler);

  once = (event, handler) =>
    this._emitter.once(event, handler);

  panTo = (annotationOrId, immediately) =>
    this._app.current.panTo(this._wrap(annotationOrId), immediately);

  get readOnly() {
    return this._app.current.readOnly;
  }

  set readOnly(readOnly) {
    this._app.current.readOnly = readOnly;
  }

  removeAnnotation = annotationOrId =>
    this._app.current.removeAnnotation(this._wrap(annotationOrId));

  saveSelected = () =>
    this._app.current.saveSelected();

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

  setWidgets = widgets =>
    this._app.current.setWidgets(widgets);

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
