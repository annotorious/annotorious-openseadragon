import React, { Component } from 'react';
import { Editor } from '@recogito/recogito-client-core';
import OSDAnnotationLayer from './annotations/OSDAnnotationLayer';

export default class OpenSeadragonAnnotator extends Component {

  state = {
    selectedAnnotation: null,
    selectionBounds: null
  }

  /** Shorthand **/
  clearState = () => this.setState({
    selectionBounds: null,
    selectedAnnotation: null,
    modifiedTarget: null
  });

  componentDidMount() {
    this.annotationLayer = new OSDAnnotationLayer(this.props.viewer);
    this.annotationLayer.on('select', this.handleSelect);
    this.annotationLayer.on('updateBounds', this.handleUpdateBounds);
  }

  handleSelect = evt => {
    const { annotation, bounds } = evt;
    if (annotation) {
      this.setState({ 
        selectedAnnotation: annotation, 
        selectionBounds: bounds 
      });

      if (!annotation.isSelection)
        this.props.onAnnotationSelected(annotation.clone());
    } else {
      this.clearState();
    }
  }

  handleUpdateBounds = (selectionBounds, modifiedTarget) =>
    this.setState({ selectionBounds, modifiedTarget });

  /**************************/  
  /* Annotation CRUD events */
  /**************************/  

  onCreateOrUpdateAnnotation = method => (annotation, previous) => {
    this.clearState();    
    this.annotationLayer.deselect();
    this.annotationLayer.addOrUpdateAnnotation(annotation, previous);
  }

  onDeleteAnnotation = evt => {
    this.clearState();
    this.annotationLayer.removeAnnotation(annotation);
    this.props.onAnnotationDeleted(annotation);
  }

  onCancelAnnotation = evt => {
    this.clearState();
    this.annotationLayer.deselect();
  }

  /****************/               
  /* External API */
  /****************/

  addAnnotation = annotation =>
    this.annotationLayer.addOrUpdateAnnotation(annotation.clone());

  removeAnnotation = annotation =>
    this.annotationLayer.removeAnnotation(annotation.clone());

  setAnnotations = annotations =>
    this.annotationLayer.init(annotations.map(a => a.clone()));

  getAnnotations = () =>
    this.annotationLayer.getAnnotations().map(a => a.clone());

  render() {
    return (
      this.state.selectedAnnotation && (
        <Editor
          wrapperEl={this.props.wrapperEl}
          bounds={this.state.selectionBounds}
          annotation={this.state.selectedAnnotation}
          onAnnotationCreated={this.onCreateOrUpdateAnnotation('onAnnotationCreated')}
          onAnnotationUpdated={this.onCreateOrUpdateAnnotation('onAnnotationUpdated')}
          onAnnotationDeleted={this.onDeleteAnnotation}
          onCancel={this.onCancelAnnotation}>

          <Editor.CommentWidget />

        </Editor>
      )
    )
  }

}