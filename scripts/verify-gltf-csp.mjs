import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

// Pass the installed Playwright directory when it is provided by the workspace runtime.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.BIBLIOTECA_PLAYWRIGHT ?? 'playwright');
const config = JSON.parse(await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
const csp = config.app.security.csp;
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/animated-triangle.gltf', import.meta.url), 'utf8'));
const cases = [{ name: 'integrated', source: JSON.stringify(fixture), resources: [] }];
const binary = Buffer.from(fixture.buffers[0].uri.split(',')[1], 'base64');
fixture.buffers[0].uri = 'geometry.bin';
cases.push({ name: 'external', source: JSON.stringify(fixture), resources: [{ uri: 'geometry.bin', mimeType: 'application/octet-stream', bytes: binary }] });
for (const file of process.argv.slice(2)) {
  const source = await readFile(file, 'utf8');
  const document = JSON.parse(source);
  const resources = [];
  for (const item of [...(document.buffers ?? []), ...(document.images ?? [])]) {
    if (!item.uri || /^(data|blob|https?):/i.test(item.uri)) continue;
    const bytes = await readFile(path.resolve(path.dirname(file), item.uri));
    const mimeType = /\.png$/i.test(item.uri) ? 'image/png' : /\.jpe?g$/i.test(item.uri) ? 'image/jpeg' : 'application/octet-stream';
    resources.push({ uri: item.uri, mimeType, bytes });
  }
  cases.push({ name: path.basename(path.dirname(path.dirname(path.dirname(file)))), source, resources });
}

function pack(test) {
  const main = Buffer.from(test.source);
  const header = Buffer.from(JSON.stringify({ directory: '', mainLength: main.length, textures: [], resources: test.resources.map(r => ({ uri: r.uri, mimeType: r.mimeType, length: r.bytes.length })) }));
  const length = Buffer.alloc(4);
  length.writeUInt32LE(header.length);
  return [...Buffer.concat([length, header, main, ...test.resources.map(r => r.bytes)])];
}

const browser = await chromium.launch({ headless: true, channel: process.env.BIBLIOTECA_BROWSER_CHANNEL || undefined });
try {
  for (const policy of ['previous', 'fixed']) {
    for (const test of cases) {
      const page = await browser.newPage({ viewport: { width: 720, height: 720 } });
      await page.addInitScript(bytes => {
        window.__TAURI_INTERNALS__ = { invoke: async () => new Uint8Array(bytes).buffer };
      }, pack(test));
      const policyText = policy === 'previous' ? csp.replace('connect-src \'self\' data: blob:', 'connect-src \'self\'') : csp;
      await page.route('**/__gltf_check', route => route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': policyText }, body: '<html><body><script type="module" src="/__gltf_check.js"></script></body></html>' }));
      await page.route('**/__gltf_check.js', route => route.fulfill({ contentType: 'application/javascript', body: `
        import { loadThreeAsset } from '/src/engine/assetLoader.ts';
        import { formatAssetError } from '/src/engine/assetError.ts';
        import * as THREE from '/node_modules/three/build/three.module.js';
        try {
          const loaded = await loadThreeAsset({path:'test.gltf',format:'gltf'});
          await loaded.texturesReady;
          const scene = new THREE.Scene(); scene.background = new THREE.Color(0x111315);
          scene.add(loaded.root, new THREE.HemisphereLight(0xffffff,0x333333,3));
          loaded.root.updateMatrixWorld(true);
          const bounds = new THREE.Box3().setFromObject(loaded.root);
          const center = bounds.getCenter(new THREE.Vector3());
          const size = bounds.getSize(new THREE.Vector3()).length();
          const camera = new THREE.PerspectiveCamera(40,1,0.01,10000);
          camera.position.copy(center).add(new THREE.Vector3(size*.6,size*.2,size*1.5)); camera.lookAt(center);
          const renderer = new THREE.WebGLRenderer({antialias:true}); renderer.setSize(680,680);
          document.body.appendChild(renderer.domElement);
          const mixer = new THREE.AnimationMixer(loaded.root);
          for (const clip of loaded.clips) {
            mixer.stopAllAction(); mixer.clipAction(clip).play();
            for (const time of [0,clip.duration*.5,clip.duration]) {
              mixer.setTime(time); loaded.root.updateMatrixWorld(true);
              loaded.root.traverse(o=>{if(!o.matrixWorld.elements.every(Number.isFinite))throw Error('Pose inválida: '+clip.name)});
              renderer.render(scene,camera);
            }
          }
          mixer.stopAllAction(); renderer.render(scene,camera);
          window.result = {ok:true,meshes:0,clips:loaded.clips.length,sampledPoses:loaded.clips.length*3,drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
          loaded.root.traverse(o=>{if(o.isMesh)window.result.meshes++});
        } catch(error) { window.result = {ok:false,error:formatAssetError(error)}; }
      ` }));
      await page.goto('http://127.0.0.1:1430/__gltf_check');
      await page.waitForFunction(() => window.result, { timeout: 60000 });
      const result = await page.evaluate(() => window.result);
      console.log(JSON.stringify({ policy, file: test.name, ...result }));
      assert.equal(result.ok, policy === 'fixed');
      if (result.ok) {
        assert.ok(result.meshes > 0);
        assert.ok(result.drawCalls > 0);
        assert.ok(result.triangles > 0);
        await mkdir('artifacts', { recursive: true });
        await page.screenshot({path:`artifacts/gltf-${test.name}-v${config.version}.png`});
      }
      await page.close();
    }
  }
} finally { await browser.close(); }
