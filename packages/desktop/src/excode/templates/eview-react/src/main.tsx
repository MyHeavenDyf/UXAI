import React from 'react';
import ReactDOM from 'react-dom/client';
import { IntlProvider } from 'react-intl';
import { RouterProvider } from 'react-router-dom';
import componentsLocales from '@nce/eview-react/locales';
import router from './routes';
import '@nce/eview-react/styles/aui3_1.css';
import './styles/global.less';
import './styles/base.css';
import './styles/hui-base.css';
import './styles/hui-base-dark.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <IntlProvider locale="zh" messages={componentsLocales.zh}>
    <RouterProvider router={router} />
  </IntlProvider>
);
