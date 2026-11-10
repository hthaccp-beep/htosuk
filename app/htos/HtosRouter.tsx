import React, {useState} from 'react';
import {createHashRouter, RouterProvider} from 'react-router-dom';
import {ScreenRecovery} from '../../components/AppRecovery';

// A data router lets unsaved forms block links and browser Back/Forward equally.
export function HtosRouter({children}: {children: React.ReactNode}) {
  const [router] = useState(() => createHashRouter([{path:'*', element:children, errorElement:<ScreenRecovery/>}]));
  return <RouterProvider router={router}/>;
}
