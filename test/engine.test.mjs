import test from 'node:test';
import assert from 'node:assert/strict';
import {planGame,recordPost,requestGame,parseRequest,weeklyWindow,weeklyIndex,planWeeklyIndex} from '../src/engine.mjs';
const now=Date.parse('2027-03-13T16:40:00Z');
const game=()=>({id:'g1',sport:'lacrosse-men',division:'d1',status:'scheduled',observedAt:new Date(now).toISOString(),
 startTime:'2027-03-13T17:00:00Z',away:{id:'a',name:'Away'},home:{id:'b',name:'Home'}});
const poll={publishedAt:'2027-03-08T12:00:00Z',ranks:{a:1,b:20}};
test('both teams must be ranked, including the IL top-20 boundary',()=>{
 assert.equal(planGame(game(),{},poll,now).actions.length,1);
 assert.equal(planGame(game(),{},{...poll,ranks:{a:1,b:21}},now).actions.length,0);
 assert.equal(planGame(game(),{},{...poll,ranks:{a:1}},now).actions.length,0);
});
test('weekly index includes Saturday through Friday in Eastern time across DST',()=>{
 assert.deepEqual(weeklyWindow(now),{saturday:'2027-03-13',friday:'2027-03-19',isSaturday:true});
 const starts=['2027-03-13T04:59:00Z','2027-03-13T05:00:00Z','2027-03-19T23:00:00Z','2027-03-20T03:59:00Z','2027-03-20T04:00:00Z'];
 const games=starts.map((startTime,i)=>({...game(),id:`edge-${i}`,startTime}));
 const body=weeklyIndex(games,{},null,now);
 for(const id of ['edge-1','edge-2','edge-3']) assert.ok(body.includes(id));
 for(const id of ['edge-0','edge-4']) assert.ok(!body.includes(id));
 assert.deepEqual(weeklyWindow(Date.parse('2027-03-17T12:00:00Z')),{saturday:'2027-03-13',friday:'2027-03-19',isSaturday:false});
});
test('weekly index creates only on Saturday after 8am and once per week',()=>{
 assert.ok(planWeeklyIndex([],{},null,now));
 assert.equal(planWeeklyIndex([],{},null,now,{'2027-03-13':'t3_existing'}),null);
 assert.equal(planWeeklyIndex([],{},null,Date.parse('2027-03-13T11:00:00Z')),null);
 assert.equal(planWeeklyIndex([],{},null,Date.parse('2027-03-14T16:00:00Z')),null);
 assert.equal(planWeeklyIndex([],{},null,now,{}, {enabled:false}),null);
});
test('requested unranked game gets a thread and duplicate requests are harmless',()=>{
 const s=requestGame(game(),{},now);
 assert.deepEqual(requestGame(game(),s,now),s);
 assert.equal(planGame(game(),s,null,now).actions.length,1);
});
test('no posting early, paused, postponed or from stale feeds/polls',()=>{
 assert.equal(planGame(game(),{},poll,now-20*60000).actions.length,0);
 assert.equal(planGame(game(),{},poll,now,{enabled:false}).actions.length,0);
 assert.equal(planGame({...game(),status:'postponed'}, {requested:true},poll,now).actions.length,0);
 assert.equal(planGame({...game(),observedAt:new Date(now-11*60000).toISOString()}, {},poll,now).actions.length,0);
 assert.equal(planGame(game(),{},{...poll,publishedAt:'2027-02-01T00:00:00Z'},now).actions.length,0);
});
test('published game is not duplicated; final needs two fresh observations',()=>{
 let s=recordPost({},'game','t3_abc',poll,now);
 assert.equal(planGame(game(),s,poll,now).actions.length,0);
 const final={...game(),status:'final',away:{id:'a',name:'Away',score:12},home:{id:'b',name:'Home',score:11},overtime:2};
 let p=planGame(final,s,poll,now); assert.equal(p.actions.length,0);
 s=p.state;
 assert.equal(planGame(final,s,poll,now+3*60000).actions.length,0,'same snapshot is not confirmation');
 p=planGame({...final,observedAt:new Date(now+3*60000).toISOString()},s,null,now+3*60000);
 assert.equal(p.actions.length,1); assert.match(p.actions[0].title,/#1 Away.*12–11 \(2OT\)/);
 s=recordPost(p.state,'postgame','t3_def',poll,now);
 assert.equal(planGame({...final,observedAt:new Date(now+4*60000).toISOString()},s,poll,now+4*60000).actions.length,0);
});
test('score correction restarts confirmation; never backfill unrelated finals',()=>{
 const final={...game(),status:'final',away:{id:'a',name:'Away',score:12},home:{id:'b',name:'Home',score:11}};
 assert.equal(planGame(final,{},poll,now).actions.length,0);
 const s=planGame(final,{gamePostId:'t3_abc'},poll,now).state;
 const corrected={...final,observedAt:new Date(now+3*60000).toISOString(),away:{...final.away,score:13}};
 assert.equal(planGame(corrected,s,poll,now+3*60000).actions.length,0);
});
test('invalid scores and wrong sport rejected; requests parse strictly',()=>{
 assert.throws(()=>planGame({...game(),sport:'lacrosse-women'},{},poll,now));
 assert.throws(()=>planGame({...game(),status:'final'},{},poll,now));
 assert.equal(parseRequest('!thread g1'),'g1'); assert.equal(parseRequest('hello !thread g1'),null);
 assert.throws(()=>requestGame({...game(),status:'canceled'},{},now));
});
