  export const getSnippet = (viewer, annotation) => {
    // Scale factor for OSD canvas element (physical vs. logical resolution)
    const { canvas } = viewer.drawer;
    const canvasBounds = canvas.getBoundingClientRect();
    const kx = canvas.width / canvasBounds.width;
    const ky = canvas.height / canvasBounds.height;

    // Parse fragment selector (image coordinates)
    // WARNING: a hack that STRICTLY assumes a box selection
    // from Annotorious (will break for polygon selections)
    const [ xi, yi, wi, hi ] = annotation.target.selector.value
      .split(':')[1]
      .split(',')
      .map(str => parseFloat(str));

    // Convert image coordinates (=annotation) to viewport coordinates (=OpenSeadragon canvas)
    const topLeft = viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(xi, yi));
    const bottomRight =  viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(xi + wi, yi + hi));

    const { x, y } = topLeft;
    const w = bottomRight.x - x;
    const h = bottomRight.y - y;

    // Cut out the image snippet as in-memory canvas element
    const snippet = document.createElement('CANVAS');
    const ctx = snippet.getContext('2d');
    snippet.width = w;
    snippet.height = h;
    ctx.drawImage(canvas, x * kx, y * ky, w * kx, h * ky, 0, 0, w * kx, h * ky);

    // Current image zoom from OSD
    const imageZoom = viewer.viewport.viewportToImageZoom(viewer.viewport.getZoom()); 

    // Return snippet canvas + a tranform to convert canvas coordinates to image coordinates
    return { 
      snippet, 
      transform: xy => {
        const px = xi + (xy[0] / kx) / imageZoom;
        const py = yi + (xy[1] / ky) / imageZoom;
        return [ px, py ];
      }
    };
  }