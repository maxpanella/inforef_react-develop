import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const LoginPage = () => {
  const { login, isAuthenticated, loginError } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Reindirizza se già autenticato
  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard');
    }
  }, [isAuthenticated, navigate]);

  // Aggiorna l'errore quando cambia loginError
  useEffect(() => {
    setError(loginError || '');
  }, [loginError]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Validazione base
    if (!username || !password) {
      setError('Inserisci sia username che password');
      setLoading(false);
      return;
    }

    const success = login(username, password);
    setLoading(false);

    if (success) {
      navigate('/dashboard');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-gray-800">BlueIOT Tracking</h2>
          <p className="text-gray-600 mt-1">Accedi per gestire il tuo sistema</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-md">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input
              id="username"
              type="email"
              placeholder="email@esempio.com"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2.5 border"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              placeholder="••••••••"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 p-2.5 border"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className={`w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                loading ? 'opacity-70 cursor-not-allowed' : ''
              }`}
            >
              {loading ? 'Accesso...' : 'Accedi'}
            </button>
          </div>
        </form>

        <div className="mt-6">
          <p className="text-xs text-center text-gray-500">
            Per accedere in modalità demo: <strong>admin@example.com</strong> / <strong>password</strong>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;