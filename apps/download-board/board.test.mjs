import test from 'node:test';
import assert from 'node:assert/strict';
import {isDownloadReady,visibleReleases,formatBytes,formatDate} from './site/app.mjs';
const base={platform:'aos',status:'published',qaStatus:'PASS',version:'1.0.0',build:'1',file:'/downloads/v1.0.0/kimgosu.apk',sha256:'a'.repeat(64),bytes:1000,publishedAt:'2026-10-30T10:00:00Z',notes:['첫 앱']};
test('QA 통과 최종 파일만 표시',()=>{assert.equal(isDownloadReady(base),true);for(const status of ['FAIL','BLOCKED','NOT_RUN',null])assert.equal(isDownloadReady({...base,qaStatus:status}),false);assert.equal(isDownloadReady({...base,status:'candidate'}),false);});
test('경로 이탈·외부 링크 차단',()=>{for(const file of ['/downloads/../secret.apk','https://example.com/a.apk','javascript:a.apk','/downloads/file.exe'])assert.equal(isDownloadReady({...base,file}),false);});
test('잘못된 해시·파일크기 차단',()=>{assert.equal(isDownloadReady({...base,sha256:'bad'}),false);for(const bytes of [0,-1,NaN,1.1])assert.equal(isDownloadReady({...base,bytes}),false);});
test('플랫폼별 필터',()=>{const ios={...base,platform:'ios',file:'/downloads/ios/app.zip'};assert.equal(visibleReleases([base,ios],'aos').length,1);assert.equal(visibleReleases([base,ios],'ios').length,1);assert.equal(visibleReleases([base,ios]).length,2);});
test('버전/변경사항 검색',()=>{assert.equal(visibleReleases([base],'all','1.0.0').length,1);assert.equal(visibleReleases([base],'all','첫 앱').length,1);assert.equal(visibleReleases([base],'all','없는 버전').length,0);});
test('최신 게시글 우선·미승인 제외',()=>{const newer={...base,build:'2',publishedAt:'2026-10-30T11:00:00Z'};assert.equal(visibleReleases([base,newer,{...base,qaStatus:'FAIL'}])[0].build,'2');});
test('파일크기와 한국시간 표시',()=>{assert.equal(formatBytes(59404),'59.4 KB');assert.equal(formatBytes(14571275),'14.6 MB');assert.equal(formatDate('not a date'),'일시 확인 중');assert.match(formatDate('2026-10-30T09:00:00Z'),/2026/);});
test('등록 전에는 빈 게시판',()=>assert.deepEqual(visibleReleases([]),[]));
test('변경사항은 비어있지 않은 문자열 배열만 허용',()=>{for(const notes of [undefined,null,42,'문구',{},[],[''],[' '],[12]]){assert.equal(isDownloadReady({...base,notes}),false);assert.deepEqual(visibleReleases([{...base,notes}]),[]);}assert.equal(isDownloadReady({...base,notes:['한글 변경사항']}),true);});
test('명칭은 김고수, 공개 문구는 최소화',async()=>{const {readFile}=await import('node:fs/promises');const html=await readFile(new URL('./site/index.html',import.meta.url),'utf8');assert.match(html,/<title>김고수 앱 다운로드<\/title>/);for(const text of ['뉴김고수','NEW KIMGOSU','APP DOWNLOADS','QA','등록 준비 중','만나보세요','다운로드 전 확인하세요'])assert.equal(html.includes(text),false);assert.match(html,/id="search"/);assert.match(html,/data-platform="ios"/);});

