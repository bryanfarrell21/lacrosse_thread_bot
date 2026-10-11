import {mkdir,writeFile} from 'node:fs/promises';
import {planGame,recordPost,requestGame,weeklyIndex} from '../src/engine.mjs';
// Entirely fictional games and poll, for repeatable preview only.
const now=Date.parse('2027-03-13T16:40:00Z');
const poll={source:'DEMO poll — fictional rankings',publishedAt:'2027-03-08T12:00:00Z',ranks:{maryland:3,hopkins:12}};
const games=[{id:'demo-001',sport:'lacrosse-men',division:'d1',status:'scheduled',
  observedAt:new Date(now).toISOString(),startTime:'2027-03-13T17:00:00Z',
  away:{id:'hopkins',name:'Johns Hopkins',record:'4–1'},home:{id:'maryland',name:'Maryland',record:'5–0'},venue:'Demo venue'},
  {id:'demo-002',sport:'lacrosse-men',division:'d1',status:'scheduled',
  observedAt:new Date(now).toISOString(),startTime:'2027-03-13T17:00:00Z',
  away:{id:'towson',name:'Towson'},home:{id:'delaware',name:'Delaware'}}];
const states={'demo-002':requestGame(games[1],{},now)};
await mkdir('preview',{recursive:true});
await writeFile('preview/weekly-index.md',weeklyIndex(games,states,poll,now));
for(const g of games){
  let {state,actions}=planGame(g,states[g.id],poll,now);
  for(const a of actions) await writeFile(`preview/${g.id}-${a.kind}.md`,`${a.title}\n\n${a.body}`);
  state=recordPost(state,'game','t3_demo',poll,now);
  const final={...g,status:'final',observedAt:'2027-03-13T19:00:00Z',away:{...g.away,score:10},home:{...g.home,score:12}};
  state=planGame(final,state,poll,Date.parse(final.observedAt)).state;
  final.observedAt='2027-03-13T19:03:00Z';
  for(const a of planGame(final,state,poll,Date.parse(final.observedAt)).actions)
    await writeFile(`preview/${g.id}-${a.kind}.md`,`${a.title}\n\n${a.body}`);
}
console.log('Wrote fictional weekly index, automatic/requested game threads, and postgame previews to preview/. No Reddit calls.');
