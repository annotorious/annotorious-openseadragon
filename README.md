# Annotorious Openseadragon

An experimental integration between the [Annotorious](https://github.com/recogito/annotorious) image annotation tool and the [OpenSeadragon](https://openseadragon.github.io/) viewer for high-resolution zoomable images. __Work in progress!__

Try the [online demo](https://recogito.github.io/annotorious-openseadragon/).

## Installing

Download the [latest release](https://github.com/recogito/annotorious-openseadragon/releases/latest)
and include it in your web page.

```html
<script src="annotorious-openseadragon.min.js"></script>
```

## Using

```html
<script src="openseadragon/openseadragon.2.4.2.min.js"></script>
<script>
  (function() {
    var viewer = OpenSeadragon({
      id: "openseadragon",
      prefixUrl: "openseadragon/images/",
      tileSources: {
        type: "image",
        url: "1280px-Hallstatt.jpg"
      }
    });
    
    var anno = AnnotoriousOSD.init(document.getElementById('openseadragon'), viewer);
    anno.loadAnnotations('annotations.w3c.json');
  })()
</script>
```

## License

[BSD 3-Clause](LICENSE) (= feel free to use this code in whatever way
you wish. But keep the attribution/license file, and if this code
breaks something, don't complain to us :-)


