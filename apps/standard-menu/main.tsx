import React from 'react';
import {createRoot} from 'react-dom/client';
import {StandardMenuApp} from './App';
import '../../app/htos/htos.css';
import '../../app/htos/brand.css';
createRoot(document.getElementById('root')!).render(<StandardMenuApp/>);
