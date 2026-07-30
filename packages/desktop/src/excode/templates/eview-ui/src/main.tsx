import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider } from '@cloudsop/eview-ui';
import { RouterProvider } from 'react-router-dom';
import router from './routes';
import '@cloudsop/eview-ui/styles/aui3.1.less';
import './styles/global.less';
import './styles/base.css';
import './styles/hui-base.css';
import './styles/hui-base-dark.css';

ReactDOM.createRoot(document.getElementById('root')).render(
    <ConfigProvider locale="zh">
      <RouterProvider router={router} />
    </ConfigProvider>
);
