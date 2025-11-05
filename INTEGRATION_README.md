# Guida Integrazione BlueIOT con SGSL Web

## Panoramica

Questo sistema integra il tracciamento in tempo reale BlueIOT con il CRM SGSL Web per la gestione di cantieri edili.

## Configurazione API SGSL Web

### Endpoint disponibili

1. **Informazioni Azienda**

   - `GET /api/v1/company/{id}` - Recupera i dettagli dell'azienda

2. **Gestione Dipendenti**

   - `GET /api/v1/employee` - Lista tutti i dipendenti
   - `GET /api/v1/employee/{id}` - Dettagli singolo dipendente
   - `GET /api/v1/company/employees/{companyId}` - Dipendenti per azienda

3. **Autorizzazioni e Formazione**
   - `GET /api/v1/employee/machine/{id}` - Macchinari autorizzati per dipendente
   - `GET /api/v1/employee/training/{id}` - Formazione del dipendente
   - `GET /api/v1/employee/dpi/{id}` - DPI assegnati al dipendente

### Configurazione

1. Aggiorna il file `.env` con le credenziali corrette:

```env
REACT_APP_CRM_BASE_URL=https://apidemobo01.sgslweb.com
REACT_APP_COMPANY_ID=1
```

2. Se necessario, aggiungi headers di autenticazione nel `crmClient.js`:

```javascript
headers: {
  'Authorization': 'Bearer YOUR_API_TOKEN',
  'Accept': 'application/json',
  'Content-Type': 'application/json'
}
```

## Flusso di Lavoro

### 1. Importazione Dati

Quando l'utente clicca su "Importa da CRM SGSL":

1. Il sistema recupera le informazioni aziendali
2. Scarica la lista dei dipendenti dell'azienda
3. Per ogni dipendente, recupera le autorizzazioni ai macchinari
4. Salva tutti i dati nel database locale SQLite

### 2. Associazione Tag

1. I tag BlueIOT vengono rilevati automaticamente
2. L'operatore può associare ogni tag a:
   - Un dipendente (per tracciamento personale)
   - Un macchinario (per tracciamento asset)

### 3. Tracciamento Real-time

- Le posizioni vengono aggiornate ogni 3 secondi
- La mappa mostra in tempo reale:
  - Dipendenti (pallini blu)
  - Macchinari (pallini verdi)
- Informazioni dettagliate disponibili al click

## Struttura Dati

### Dipendente (Employee)

```javascript
{
  id: number,
  name: string,
  role: string,
  email: string,
  phone: string,
  fiscalCode: string,
  birthDate: string,
  hireDate: string,
  department: string,
  isActive: boolean
}
```

### Macchinario (Asset)

```javascript
{
  id: number,
  name: string,
  type: string,
  model: string,
  serialNumber: string,
  manufacturer: string,
  lastMaintenance: string,
  nextMaintenance: string,
  isOperational: boolean
}
```

## Troubleshooting

### Errore CORS

Se ricevi errori CORS quando chiami le API SGSL:

1. Verifica che il dominio sia whitelistato lato server
2. Usa un proxy in sviluppo aggiungendo al `package.json`:

```json
"proxy": "https://apidemobo01.sgslweb.com"
```

### Nessun dato importato

1. Verifica che il COMPANY_ID sia corretto
2. Controlla i log della console per errori API
3. Verifica che l'utente abbia i permessi necessari

### Tag non rilevati

1. Assicurati che il server BlueIOT sia raggiungibile
2. Verifica IP e porta nelle impostazioni
3. Controlla lo stato della connessione nell'indicatore in basso a destra

## Sviluppo

### Aggiungere nuovi campi

1. Aggiorna il modello nel `crmClient.js`
2. Modifica lo schema del database in `server.js`
3. Aggiorna i componenti UI per visualizzare i nuovi dati

### Test con dati mock

Imposta `REACT_APP_USE_MOCK_DATA=true` per usare dati di test senza chiamare le API reali.

## Sicurezza

- Le credenziali API dovrebbero essere gestite tramite variabili d'ambiente
- Non committare mai file `.env` con credenziali reali
- Implementa autenticazione JWT per l'accesso al sistema
- Usa HTTPS per tutte le comunicazioni

## Prossimi Passi

1. Implementare filtri per cantiere/sede
2. Aggiungere notifiche per eventi critici (es. DPI scaduti)
3. Integrazione con sistemi di videosorveglianza
4. Report e analytics avanzati
5. App mobile per supervisori cantiere
