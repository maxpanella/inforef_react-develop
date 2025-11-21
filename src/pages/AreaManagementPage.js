import React, { useState } from 'react';
import { loadAreas, saveAreas } from '../config/areas';
import { useData } from '../context/DataContext';

// Simple point-in-polygon (ray casting)
function pointInPoly(pt, poly){
  let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const xi=poly[i][0], yi=poly[i][1]; const xj=poly[j][0], yj=poly[j][1];
    const intersect=((yi>pt.y)!==(yj>pt.y)) && (pt.x < (xj-xi)*(pt.y-yi)/(yj-yi+1e-12)+xi);
    if(intersect) inside=!inside;
  } return inside;
}

export default function AreaManagementPage(){
  const [areas,setAreas]=useState(loadAreas());
  const [selected,setSelected]=useState(null);
  const [newId,setNewId]=useState('');
  const [newLabel,setNewLabel]=useState('');
  const [mode,setMode]=useState('idle'); // idle | drawing
  const { positions } = useData();

  const startDrawing=()=>{ setMode('drawing'); setSelected(null); };
  const addPoint=()=>{
    const p = window.__DXF_LAST_CLICK;
    if(!p){ alert('Clicca sulla mappa prima (nessun punto memorizzato)'); return; }
    setAreas(prev => prev.map(a => a.id===selected ? { ...a, polygon:[...a.polygon,[p.rawOriginalX??p.x,p.rawOriginalY??p.y]] } : a));
  };
  const createArea=()=>{
    if(!newId) return;
    const p = window.__DXF_LAST_CLICK;
    const poly = p ? [[p.rawOriginalX??p.x,p.rawOriginalY??p.y]] : [];
    const area={ id:newId.trim(), label:newLabel||newId.trim(), color: '#10b981', polygon: poly, offset:{dx:0,dy:0} };
    setAreas([...areas, area]); setSelected(area.id); setMode('drawing'); setNewId(''); setNewLabel('');
  };
  const save=()=>{ saveAreas(areas); alert('Aree salvate'); };
  const remove=(id)=>{ if(!window.confirm('Rimuovere area '+id+'?')) return; setAreas(areas.filter(a=>a.id!==id)); if(selected===id) setSelected(null); };
  const finish=()=>{ setMode('idle'); saveAreas(areas); };

  // Quick test: classify first 10 tags
  const sampleTags = Object.entries(positions).slice(0,10).map(([id,pos])=>{
    const raw = { x:Number(pos.x)||0, y:Number(pos.y)||0 };
    const hit = areas.find(a=> pointInPoly(raw,a.polygon));
    return { id, area: hit? hit.id : '-' };
  });

  return (
    <div className='p-4'>
      <h2 className='text-lg font-semibold mb-2'>Gestione Aree Logiche</h2>
      <p className='text-xs text-gray-600 mb-3'>Clicca sulla mappa (DXF) per registrare punti; usa "Aggiungi Punto" per estendere il poligono dell'area selezionata. Le coordinate usano il sistema raw della mappa, indipendente dalla rotazione visuale.</p>
      <div className='flex gap-4 flex-wrap'>
        <div className='w-64'>
          <div className='text-sm font-medium mb-1'>Aree</div>
          <ul className='border rounded divide-y max-h-64 overflow-auto text-xs'>
            {areas.map(a=> (
              <li key={a.id} className={'p-2 flex items-center justify-between '+(selected===a.id?'bg-blue-50':'')}> 
                <span onClick={()=>{ setSelected(a.id); }} className='cursor-pointer'>{a.label} ({a.id}) [{a.polygon.length}p]</span>
                <button onClick={()=>remove(a.id)} className='text-red-600 text-[10px]'>x</button>
              </li>
            ))}
          </ul>
          <div className='mt-2 space-y-1'>
            <input placeholder='ID area' value={newId} onChange={e=>setNewId(e.target.value)} className='border rounded w-full px-1 py-0.5 text-xs'/>
            <input placeholder='Label' value={newLabel} onChange={e=>setNewLabel(e.target.value)} className='border rounded w-full px-1 py-0.5 text-xs'/>
            <button onClick={createArea} className='w-full bg-blue-600 text-white rounded px-2 py-1 text-xs'>Crea & Disegna</button>
          </div>
          {selected && (
            <div className='mt-3 space-y-1'>
              <div className='text-xs font-medium'>Area selezionata: {selected}</div>
              <button onClick={addPoint} className='w-full bg-indigo-600 text-white rounded px-2 py-1 text-xs'>Aggiungi Punto (ultimo click)</button>
              <button onClick={finish} className='w-full bg-emerald-600 text-white rounded px-2 py-1 text-xs'>Fine Disegno</button>
            </div>
          )}
          <button onClick={save} className='mt-3 w-full bg-emerald-700 text-white rounded px-2 py-1 text-xs'>Salva Aree</button>
        </div>
        <div className='flex-1 min-w-[280px]'>
          <div className='text-sm font-medium mb-1'>Classificazione Rapida (prime 10 posizioni)</div>
          <table className='text-xs w-full border'>
            <thead><tr className='bg-gray-100'><th className='border px-1'>Tag</th><th className='border px-1'>Area</th></tr></thead>
            <tbody>
              {sampleTags.map(t=> <tr key={t.id}><td className='border px-1'>{t.id}</td><td className='border px-1'>{t.area}</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
      <div className='mt-4 text-[10px] text-gray-500'>Suggerimento: apri il Dashboard a fianco, clicca punti sulla mappa per acquisire coordinate; torna qui e premi "Aggiungi Punto".</div>
    </div>
  );
}
