import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar = () => {
	const { isAuthenticated, logout } = useAuth();
	const location = useLocation();

	if (!isAuthenticated) return null;

	// Determina se un link è attivo
	const isActive = (path) => location.pathname === path;

	// Stile per link attivo/inattivo
	const linkStyle = (path) =>
		`px-3 py-2 rounded-md text-sm font-medium transition ${
			isActive(path)
				? 'bg-blue-800 text-white'
				: 'text-blue-100 hover:bg-blue-700 hover:text-white'
		}`;

	return (
		<nav className='bg-blue-700 text-white shadow mb-6'>
			<div className='max-w-7xl mx-auto px-4 py-2'>
				<div className='flex items-center justify-between h-12'>
					{/* Logo e nome app */}
					<div className='flex items-center'>
						<span className='text-xl font-bold'>BlueIOT Tracking</span>
					</div>

					{/* Menu principale */}
					<div className='hidden md:block'>
						<div className='flex items-center space-x-1'>
							<Link to='/dashboard' className={linkStyle('/dashboard')}>
								Dashboard
							</Link>
							<Link to='/configuration' className={linkStyle('/configuration')}>
								Configurazione
							</Link>
							<Link
								to='/map-management'
								className={linkStyle('/map-management')}
							>
								Gestione Mappe
							</Link>
							<Link
								to='/tag-association'
								className={linkStyle('/tag-association')}
							>
								Associa Tag
							</Link>
							<Link to='/alarms' className={linkStyle('/alarms')}>
								Allarmi
							</Link>
							<Link to='/battery' className={linkStyle('/battery')}>
								Batterie
							</Link>
							<Link to='/employees' className={linkStyle('/employees')}>
								Dipendenti
							</Link>
							<Link to='/assets' className={linkStyle('/assets')}>
								Macchinari
							</Link>
							<Link to='/areas' className={linkStyle('/areas')}>
								Aree
							</Link>
							<button
								onClick={logout}
								className='ml-4 bg-red-600 hover:bg-red-700 transition text-white px-3 py-2 rounded-md text-sm font-medium'
							>
								Logout
							</button>
						</div>
					</div>

					{/* Menu mobile (da implementare con toggle) */}
					<div className='md:hidden'>
						<button
							type='button'
							className='bg-blue-800 p-1 rounded-md text-blue-100 hover:text-white focus:outline-none'
							aria-controls='mobile-menu'
							aria-expanded='false'
						>
							<span className='sr-only'>Apri menu</span>
							<svg
								className='h-6 w-6'
								xmlns='http://www.w3.org/2000/svg'
								fill='none'
								viewBox='0 0 24 24'
								stroke='currentColor'
							>
								<path
									strokeLinecap='round'
									strokeLinejoin='round'
									strokeWidth='2'
									d='M4 6h16M4 12h16M4 18h16'
								/>
							</svg>
						</button>
					</div>
				</div>
			</div>

			{/* Menu mobile */}
			<div className='hidden md:hidden' id='mobile-menu'>
				<div className='px-2 pt-2 pb-3 space-y-1 sm:px-3'>
					<Link to='/dashboard' className={linkStyle('/dashboard')}>
						Dashboard
					</Link>
					<Link to='/configuration' className={linkStyle('/configuration')}>
						Configurazione
					</Link>
					<Link to='/map-management' className={linkStyle('/map-management')}>
						Gestione Mappe
					</Link>
					<Link to='/tag-association' className={linkStyle('/tag-association')}>
						Associa Tag
					</Link>
					<Link to='/alarms' className={linkStyle('/alarms')}>
						Allarmi
					</Link>
					<Link to='/battery' className={linkStyle('/battery')}>
						Batterie
					</Link>
					<button
						onClick={logout}
						className='w-full text-left mt-2 bg-red-600 hover:bg-red-700 transition text-white px-3 py-2 rounded-md text-sm font-medium'
					>
						Logout
					</button>
				</div>
			</div>
		</nav>
	);
};

export default Navbar;
