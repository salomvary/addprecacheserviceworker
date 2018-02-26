const AssetGraph = require('assetgraph')
const addPrecacheServiceWorker = require('../addPrecacheServiceWorker')

AssetGraph.registerTransform(addPrecacheServiceWorker, 'addPrecacheServiceWorker')

new AssetGraph({root: __dirname})
    .logEvents()
    .loadAssets('*.html')
    .populate()
    .addPrecacheServiceWorker()
    .writeAssetsToDisc({isLoaded: true}, __dirname + '/dist')
    .writeStatsToStderr()
    .run(function (err, assetGraph) {
      if (err) {
        console.error('error', err)
      } else {
        console.log('done')
      }
    })
