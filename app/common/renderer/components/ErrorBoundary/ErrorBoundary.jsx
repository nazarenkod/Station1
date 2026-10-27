import {Component} from 'react';

import {backend} from '../../polyfills.js';
import {copyToClipboard} from '../../utils/other.js';
import ErrorMessage from './ErrorMessage.jsx';

const copyTrace = (trace) => {
  copyToClipboard(trace);
};

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      error: null,
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return {error};
  }

  componentDidCatch(error, info) {
    backend.journal?.report({
      text: `render error: ${error?.message ?? error}`,
      detail: [error?.stack, info?.componentStack].filter(Boolean).join('\n'),
    });
  }

  render() {
    const {error} = this.state;
    if (error) {
      return <ErrorMessage error={error} copyTrace={copyTrace} />;
    }
    return this.props.children;
  }
}
