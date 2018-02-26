const _ = require('lodash');
const urlTools = require('urltools');
const swPrecache = require('sw-precache');
const commonPathPrefix = require('common-path-prefix');
const Promise = require('bluebird');

module.exports = (queryObj, options) => {
  options = options || {};
  return async function addPrecacheServiceWorker(assetGraph) {
    async function generateAndAttachPrecacheServiceWorkerAsync(
      entryPointHtmlAssets
    ) {
      // Invariant: All entryPointHtmlAssets must have the same origin
      const textOrRawSrcByUrl = {};
      for (const htmlAsset of entryPointHtmlAssets) {
        assetGraph.eachAssetPostOrder(
          htmlAsset,
          {
            type: {
              $nin: [
                'HtmlAnchor',
                'SvgAnchor',
                'HtmlMetaRefresh',
                'HtmlCacheManifest',
                'HtmlConditionalComment',
                'JavaScriptSourceUrl',
                'JavaScriptSourceMappingUrl',
                'JavaScriptSourceMap'
              ]
            }
          },
          asset => {
            // But only if the asset isn't inline, has been loaded, and isn't already in the manifest:
            if (!asset.isInline && asset.isLoaded && asset !== htmlAsset) {
              const url = require('urltools').buildRootRelativeUrl(
                assetGraph.root,
                asset.url,
                assetGraph.root
              );
              textOrRawSrcByUrl[url] = asset.isText ? asset.text : asset.rawSrc;
            }
          }
        );
      }

      const entryPointAssetPaths = [];
      let serviceWorkerFileNameFragments = [];
      for (const entryPointAsset of entryPointHtmlAssets) {
        entryPointAssetPaths.push(entryPointAsset.url);
        const basename = entryPointAsset.fileName.replace(/\..*$/, '');
        if (basename) {
          serviceWorkerFileNameFragments.push(basename);
        }
      }
      serviceWorkerFileNameFragments = _.uniq(
        serviceWorkerFileNameFragments.sort()
      );
      serviceWorkerFileNameFragments.push('precache-service-worker.js');

      const baseUrl = commonPathPrefix(entryPointAssetPaths);
      if (!baseUrl || /^[^:]*:\/+$/.test(baseUrl)) {
        throw new Error(
          'addPrecacheServiceWorker: HTML assets reside on different domains or schemes, cannot create a shared service worker'
        );
      }
      const serviceWorkerUrl =
        baseUrl + serviceWorkerFileNameFragments.join('-');
      if (assetGraph.findAssets({ url: serviceWorkerUrl }).length > 0) {
        throw new Error(
          'There is already a service worker at ' +
            serviceWorkerUrl +
            ' -- giving up'
        );
      }
      let serviceWorkerStr = await Promise.fromNode(cb =>
        swPrecache.generate(
          {
            dynamicUrlToDependencies: textOrRawSrcByUrl,
            logger(message) {
              assetGraph.info(
                serviceWorkerUrl.replace(/^.*\//, '') + ': ' + message
              );
            }
          },
          cb
        )
      );
      // Turn the string literal urls in the generated service worker scripts into JavaScriptStaticUrl:
      serviceWorkerStr = serviceWorkerStr.replace(
        /^(var precacheConfig = )(\[[^\n]*\]);/m,
        ($0, before, urlAndHashPairs) => {
          return (
            before +
            '[' +
            JSON.parse(urlAndHashPairs)
              .map(
                urlAndHash =>
                  '[' +
                  JSON.stringify(urlAndHash[0]) +
                  ".toString('url')," +
                  JSON.stringify(urlAndHash[1]) +
                  ']'
              )
              .join(',') +
            '];'
          );
        }
      );
      assetGraph.addAsset({
        type: 'JavaScript',
        url: serviceWorkerUrl,
        text: serviceWorkerStr
      });
      for (const htmlAsset of entryPointHtmlAssets) {
        htmlAsset.addRelation(
          {
            type: 'HtmlScript',
            hrefType: 'inline',
            to: {
              type: 'JavaScript',
              text:
                "if ('serviceWorker' in navigator) {\n" +
                "    window.addEventListener('load', function () {\n" +
                "        navigator.serviceWorker.register('" +
                urlTools
                  .buildRootRelativeUrl(
                    assetGraph.root,
                    serviceWorkerUrl,
                    assetGraph.root
                  )
                  .replace(/'/g, "\\'") +
                "');\n" +
                '    });\n' +
                '}\n'
            }
          },
          'lastInBody'
        );
      }
    }

    const entryPointHtmlAssets = assetGraph.findAssets(
      Object.assign({ type: 'Html', isInline: false }, queryObj)
    );

    let batches;
    if (options.single) {
      batches = _.values(_.groupBy(entryPointHtmlAssets, 'origin'));
      if (batches.length > 1) {
        assetGraph.info(
          new Error(
            'addPrecacheServiceWorker: HTML assets reside on different domains or schemes, creating a service worker per origin'
          )
        );
      }
    } else {
      batches = entryPointHtmlAssets.map(asset => [asset]);
    }
    await Promise.map(batches, generateAndAttachPrecacheServiceWorkerAsync, {
      concurrency: 1
    });
  };
};
