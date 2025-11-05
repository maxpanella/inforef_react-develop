import React, { useState, useEffect } from 'react';
import { useData } from '../context/DataContext';

const BatteryMonitor = () => {
  const { tags, batteryLevels, tagAssociations, employees, assets } = useData();
  const [sortedTags, setSortedTags] = useState([]);
  const [filter, setFilter] = useState('all');
  
  useEffect(() => {
    // Crea un array di tag con info batteria
    const tagsWithBattery = tags.map(tag => {
      const batteryInfo = batteryLevels[tag.id] || { level: -1, charging: false };
      const association = tagAssociations.find(a => a.tagId === tag.id);
      
      let entityName = 'Non associato';
      let entityType = null;
      
      if (association) {
        entityType = association.targetType;
        const entity = entityType === 'employee' 
          ? employees.find(e => e.id === association.targetId)
          : assets.find(a => a.id === association.targetId);
        
        if (entity) {
          entityName = entity.name;
        }
      }
      
      return {
        ...tag,
        batteryLevel: batteryInfo.level,
        charging: batteryInfo.charging,
        entityName,
        entityType
      };
    });
    
    // Filtra per tipo di entità
    let filtered = tagsWithBattery;
    if (filter === 'employee') {
      filtered = tagsWithBattery.filter(tag => tag.entityType === 'employee');
    } else if (filter === 'asset') {
      filtered = tagsWithBattery.filter(tag => tag.entityType === 'asset');
    } else if (filter === 'low') {
      filtered = tagsWithBattery.filter(tag => tag.batteryLevel >= 0 && tag.batteryLevel <= 1);
    }
    
    // Ordina per livello batteria (dal più basso)
    filtered.sort((a, b) => {
      // Metti prima quelli con livello batteria noto
      if (a.batteryLevel < 0 && b.batteryLevel >= 0) return 1;
      if (a.batteryLevel >= 0 && b.batteryLevel < 0) return -1;
      
      // Poi ordina per livello (crescente)
      return a.batteryLevel - b.batteryLevel;
    });
    
    setSortedTags(filtered);
  }, [tags, batteryLevels, tagAssociations, employees, assets, filter]);
  
  const getBatteryLevelText = (level) => {
    if (level < 0) return 'Sconosciuto';
    
    const levels = [
      '0%', '20%', '40%', '60%', '80%', '100%'
    ];
    
    return levels[level] || `${level}%`;
  };
  
  const getBatteryColorClass = (level) => {
    if (level < 0) return 'bg-gray-200';
    if (level === 0) return 'bg-red-500';
    if (level === 1) return 'bg-orange-500';
    if (level === 2) return 'bg-yellow-500';
    if (level === 3) return 'bg-green-300';
    if (level === 4) return 'bg-green-500';
    if (level === 5) return 'bg-green-600';
    return 'bg-gray-200';
  };
  
  const getBatteryWidth = (level) => {
    if (level < 0) return '0%';
    return `${(level / 5) * 100}%`;
  };
  
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">
        Monitoraggio Batterie
      </h1>
      
      {/* Filtri */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Filtra:
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className={`px-3 py-1 rounded-md text-sm font-medium ${
              filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
            onClick={() => setFilter('all')}
          >
            Tutti
          </button>
          <button
            className={`px-3 py-1 rounded-md text-sm font-medium ${
              filter === 'employee' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
            onClick={() => setFilter('employee')}
          >
            Dipendenti
          </button>
          <button
            className={`px-3 py-1 rounded-md text-sm font-medium ${
              filter === 'asset' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
            onClick={() => setFilter('asset')}
          >
            Asset
          </button>
          <button
            className={`px-3 py-1 rounded-md text-sm font-medium ${
              filter === 'low' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-700'
            }`}
            onClick={() => setFilter('low')}
          >
            Batteria bassa
          </button>
        </div>
      </div>
      
      {/* Lista batterie */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200">
          {sortedTags.length === 0 ? (
            <li className="py-12 text-center text-gray-500">
              Nessun tag trovato con questi filtri
            </li>
          ) : (
            sortedTags.map(tag => (
              <li key={tag.id} className="px-4 py-4 sm:px-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center ${
                        tag.entityType === 'employee' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                      }`}>
                        {tag.entityType === 'employee' ? (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                        )}
                      </div>
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">
                        {tag.id}
                      </div>
                      <div className="text-sm text-gray-500">
                        {tag.entityName} {tag.charging && <span className="text-green-600 ml-2">(In carica)</span>}
                      </div>
                    </div>
                  </div>
                  <div className="ml-4 flex items-center">
                    <div className="w-24 bg-gray-200 rounded-full h-4 mr-2 overflow-hidden">
                      <div 
                        className={`h-full ${getBatteryColorClass(tag.batteryLevel)}`}
                        style={{ width: getBatteryWidth(tag.batteryLevel) }}
                      ></div>
                    </div>
                    <span className={`text-sm ${
                      tag.batteryLevel <= 1 && tag.batteryLevel >= 0 ? 'text-red-600 font-bold' : 'text-gray-500'
                    }`}>
                      {getBatteryLevelText(tag.batteryLevel)}
                    </span>
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
};

export default BatteryMonitor;