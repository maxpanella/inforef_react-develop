import React from 'react';
import {
	BrowserRouter as Router,
	Routes,
	Route,
	Navigate,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { DataProvider } from './context/DataContext';

// Pagine principali
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import MapManagementPage from './pages/MapManagementPage';
import TagAssociationPage from './pages/TagAssociationPage';
import ConfigurationPage from './pages/ConfigurationPage';

// Nuove pagine e componenti
import AlarmManager from './pages/AlarmManager';
import BatteryMonitor from './pages/BatteryMonitor';
import Navbar from './components/Navbar';
import ConnectionStatus from './components/ConnectionStatus';

// Aggiungi questi import dopo gli altri import delle pagine
import EmployeeSummaryPage from './pages/EmployeeSummaryPage';
import AssetSummaryPage from './pages/AssetSummaryPage';

const App = () => {
	return (
		<AuthProvider>
			<DataProvider>
				<Router>
					<div className='min-h-screen bg-gray-100'>
						<Navbar />
						<AppContent />
					</div>
				</Router>
			</DataProvider>
		</AuthProvider>
	);
};

// Componente separato per accedere a useAuth
const AppContent = () => {
	const { isAuthenticated } = useAuth();

	return (
		<>
			{isAuthenticated && <ConnectionStatus />}
			<Routes>
				<Route path='/login' element={<LoginPage />} />
				<Route
					path='/dashboard'
					element={
						<ProtectedRoute>
							<DashboardPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path='/configuration'
					element={
						<ProtectedRoute>
							<ConfigurationPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path='/map-management'
					element={
						<ProtectedRoute>
							<MapManagementPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path='/tag-association'
					element={
						<ProtectedRoute>
							<TagAssociationPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path='/alarms'
					element={
						<ProtectedRoute>
							<AlarmManager />
						</ProtectedRoute>
					}
				/>
				<Route
					path='/battery'
					element={
						<ProtectedRoute>
							<BatteryMonitor />
						</ProtectedRoute>
					}
				/>
				<Route
					path='/employees'
					element={
						<ProtectedRoute>
							<EmployeeSummaryPage />
						</ProtectedRoute>
					}
				/>
				<Route
					path='/assets'
					element={
						<ProtectedRoute>
							<AssetSummaryPage />
						</ProtectedRoute>
					}
				/>
				<Route path='*' element={<Navigate to='/login' replace />} />
			</Routes>
		</>
	);
};

const ProtectedRoute = ({ children }) => {
	const { isAuthenticated } = useAuth();
	return isAuthenticated ? children : <Navigate to='/login' replace />;
};

export default App;
