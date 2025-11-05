import React, { useState, useEffect } from 'react';
import { useData } from '../context/DataContext';

const AlarmManager = () => {
  const { alarms, tagAssociations, employees, assets } = useData();
  const [filteredAlarms, setFilteredAlarms] = useState([]);
  const [filter, setFilter] = useState('all');
  
  // Applica filtri quando cambiano alarms o filter
  useEffect(() => {
    let filtered = [...alarms];
    
    // Ordina per timestamp (più recente prima)
    filtered.sort((a, b) => b.timestamp - a.timestamp);
    
    // Applica filtro per tipo
    if (filter !== 'all') {
      filtered = filtered.filter(alarm => alarm.type.toString() === filter);
    }
    
    setFilteredAlarms(filtered);
  }, [alarms, filter]);
  
  // Ottiene il nome dell'entità associata al tag
  const getEntityName = (tagId) => {
    const association = tagAssociations.find(a => a.tagId === tagId);
    if (!association) return 'Non associato';
    
    const entity = association.targetType === 'employee'
      ? employees.find(e => e.id === association.targetId)
      : assets.find(a => a.id === association.targetId);
      
    return entity ? entity.name : 'Entità sconosciuta';
  };
  
  // Converte tipo di allarme in testo
  const getAlarmTypeText = (type) => {
    const types = {
      1: 'Allarme geo-fence',
      2: 'Allarme SOS',
      3: 'Allarme taglio',
      4: 'Allarme sparizione',
      5: 'Allarme rimozione geo-fence',
      7: 'Batteria scarica',
      10: 'Non accompagnato',
      11: 'Ripristino ritiro temporaneo',
      12: 'Ancora offline',
      13: 'Timeout modalità riposo',
      14: 'Allarme outlier',
      15: 'Allarme permanenza',
      16: 'Allarme combinazione fence',
      20: 'Allarme sovraccarico regionale',
      21: 'Allarme frequenza cardiaca',
      22: 'Allarme fuori servizio',
      23: 'Allarme permanenza sotto limite',
      24: 'Allarme permanenza sopra limite',
      25: 'Allarme raduno'
    };
    
    return types[type] || `Tipo allarme ${type}`;
  };
  
  // Formatta timestamp
  const formatTimestamp = (ts) => {
    const date = new Date(ts);
    return date.toLocaleString();
  };
  
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">
        Gestione Allarmi
      </h1>
      
      {/* Filtri */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Filtra per tipo:
        </label>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md border"
        >
          <option value="all">Tutti gli allarmi</option>
          <option value="2">Allarme SOS</option>
          <option value="3">Allarme taglio</option>
          <option value="4">Allarme sparizione</option>
          <option value="7">Batteria scarica</option>
          <option value="12">Ancora offline</option>
          <option value="21">Allarme frequenza cardiaca</option>
        </select>
      </div>
      
      {/* Tabella allarmi */}
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        {filteredAlarms.length === 0 ? (
          <div className="py-12 text-center text-gray-500">
            Nessun allarme trovato con questi filtri
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tipo
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Tag / Entità
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Posizione
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Timestamp
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredAlarms.map((alarm) => (
                <tr key={`${alarm.id}-${alarm.timestamp}`} 
                    className={alarm.type === 2 ? 'bg-red-50' : ''}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full 
                      ${alarm.type === 2 || alarm.type === 3 ? 'bg-red-100 text-red-800' : 
                        alarm.type === 7 ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}`}>
                      {getAlarmTypeText(alarm.type)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {alarm.related_tagid}
                    </div>
                    <div className="text-sm text-gray-500">
                      {getEntityName(alarm.related_tagid)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {alarm.self_xpos && alarm.self_ypos ? (
                      <span>({alarm.self_xpos.toFixed(2)}, {alarm.self_ypos.toFixed(2)})</span>
                    ) : (
                      <span>-</span>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {formatTimestamp(alarm.timestamp)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                    <button className="text-blue-600 hover:text-blue-900 mr-4">
                      Verifica
                    </button>
                    <button className="text-red-600 hover:text-red-900">
                      Annulla
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default AlarmManager;