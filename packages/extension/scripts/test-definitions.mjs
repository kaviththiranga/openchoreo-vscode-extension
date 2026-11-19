// Copyright 2026 The OpenChoreo Authors
// SPDX-License-Identifier: Apache-2.0
// Isolated VS Code checks with a mock control plane; no real credentials or cluster.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const extension=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const req=createRequire(path.join(extension,'package.json'));
const {build}=req('esbuild');
const {runTests}=req('@vscode/test-electron');
const root=fs.mkdtempSync(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'ocr-'));
const workspace=path.join(root,'workspace'),home=path.join(root,'home'),user=path.join(root,'user');
for(const dir of [workspace,path.join(home,'.openchoreo'),path.join(user,'User')])fs.mkdirSync(dir,{recursive:true});
const resource=(kind,name,ns,spec={})=>({apiVersion:'openchoreo.dev/v1alpha1',kind,metadata:{name,namespace:ns},spec});
const component=(type)=>`apiVersion: openchoreo.dev/v1alpha1\nkind: Component\nmetadata: {name: app, namespace: default}\nspec:\n  owner: {projectName: demo}\n  componentType:\n    kind: ComponentType\n    name: ${type}\n`;
fs.writeFileSync(path.join(workspace,'component.yaml'),component('local-type'));
fs.writeFileSync(path.join(workspace,'closed-component.yaml'),component('local-type').replace('name: app', 'name: backend'));
fs.writeFileSync(path.join(workspace,'other-project.yaml'),component('local-type').replace('name: app', 'name: other-project-app').replace('projectName: demo','projectName: other'));
fs.writeFileSync(path.join(workspace,'type # local.yaml'),'apiVersion: openchoreo.dev/v1alpha1\nkind: ComponentType\nmetadata:\n  name: local-type\n  namespace: default\nspec: {}\n');
let requestCount=0;
const server=http.createServer((request,response)=>{
 requestCount++;
 const p=new URL(request.url,'http://localhost').pathname;
 let value={items:[]};
 if(p.includes('.well-known/openid-configuration')) value={issuer:`http://127.0.0.1:${server.address().port}`,authorization_endpoint:`http://127.0.0.1:${server.address().port}/authorize`,token_endpoint:`http://127.0.0.1:${server.address().port}/token`,jwks_uri:`http://127.0.0.1:${server.address().port}/jwks`};
 else if(p.includes('.well-known'))value={openchoreo_security_enabled:false,authorization_servers:[`http://127.0.0.1:${server.address().port}`],openchoreo_clients:[{name:'cli',client_id:'test',scopes:[]}]};
 else if(p==='/api/v1/namespaces')value={items:[{metadata:{name:'default'}},{metadata:{name:'other'}}]};
 else if(p.includes('/namespaces/')){
  const parts=p.split('/');const ns=parts[4],collection=parts[5],name=parts[6];
  const items=collection==='componenttypes'?[resource('ComponentType','remote-type',ns)]:collection==='traits'?[resource('Trait','logging',ns)]:collection==='components'?['remote-app','closed-app','other-project-app'].map(name => resource('Component',name,ns,{owner:{projectName:name === 'other-project-app' ? 'other' : 'demo'},componentType:{kind:'ComponentType',name:'remote-type'},traits:[{kind:'Trait',name:'logging'}]})):[];
  value=name?items.find(i=>i.metadata.name===name)??{}:{items};
 }
 response.setHeader('Content-Type','application/json');response.end(JSON.stringify(value));
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const api=`http://127.0.0.1:${server.address().port}`;
 const config={currentContext:'test',controlplanes:[{name:'test',url:api}],credentials:[{name:'test',token:''}],contexts:['test','second'].map(name=>({name,controlplane:'test',credentials:'test',namespace:'default',project:'demo'}))};
 fs.writeFileSync(path.join(home,'.openchoreo/config'),JSON.stringify(config));
 fs.writeFileSync(path.join(user,'User/settings.json'),JSON.stringify({'openchoreo.cliPath':path.resolve(process.env.OPENCHOREO_OCC_BINARY ?? path.join(extension, '../../../../occ_with_linter/openchoreo/bin/occ')),'openchoreo.lsp.trace':'verbose','files.autoSave':'off','chat.disableAIFeatures':true}));
 await build({entryPoints:[path.join(extension,'src/test/e2e/definitions.e2e.ts')],outfile:path.join(root,'definitions.js'),bundle:true,platform:'node',format:'cjs',external:['vscode']});
 fs.writeFileSync(path.join(root,'index.js'),`const Mocha=require(${JSON.stringify(req.resolve('mocha'))});exports.run=()=>new Promise((resolve,reject)=>{const m=new Mocha({timeout:60000});m.addFile(${JSON.stringify(path.join(root,'definitions.js'))});m.run(n=>n?reject(new Error(n+' tests failed')):resolve());});`);
 try{
  await runTests({vscodeExecutablePath:process.env.VSCODE_EXECUTABLE_PATH ?? (process.platform === 'darwin' && fs.existsSync('/Applications/Visual Studio Code.app/Contents/MacOS/Code') ? '/Applications/Visual Studio Code.app/Contents/MacOS/Code' : undefined),extensionDevelopmentPath:extension,extensionTestsPath:path.join(root,'index.js'),extensionTestsEnv:{HOME:home,USERPROFILE:home,OPENCHOREO_DEFINITIONS_TEST:'1',OPENCHOREO_DEFINITION_API:api},launchArgs:[workspace,'--new-window','--disable-extensions','--disable-extension=github.copilot','--disable-extension=github.copilot-chat','--disable-workspace-trust','--skip-welcome','--skip-release-notes','--disable-gpu',`--user-data-dir=${user}`,`--extensions-dir=${path.join(root,'extensions')}`]});
  console.log('VS Code navigation/reference/render-validation checks passed; mock API requests:',requestCount);
 }finally{server.close();if(process.env.OPENCHOREO_KEEP_TEST_PROFILE==='1')console.log('Isolated test profile:',root);else fs.rmSync(root,{recursive:true,force:true});}
})().catch(err=>{console.error(err);server.close();process.exitCode=1;});
