import React, { Component } from 'react';
import { Editor } from '@recogito/recogito-client-core';
import OSDAnnotationLayer from './annotations/OSDAnnotationLayer';

export default class OpenSeadragonAnnotator extends Component {

  state = {
    selectedAnnotation: null,
    selectionBounds: null
  }

  componentDidMount() {
    this.annotationLayer = new OSDAnnotationLayer(this.props.viewer);
    
    this.annotationLayer.on('updateBounds', b => this.setState({ selectionBounds: b }));

    this.annotationLayer.on('select', evt => {
      const { annotation, bounds } = evt;
      this.setState({ selectedAnnotation: annotation, selectionBounds: bounds })
    });
  }

  onCreateOrUpdateAnnotation = evt => {

  }

  onDeleteAnnotation = evt => {

  }

  onCancelAnnotation = evt => {

  }

  setAnnotations = annotations =>
    this.annotationLayer.init(annotations);

  render() {
    return (this.state.selectedAnnotation && <Editor
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
  }

}