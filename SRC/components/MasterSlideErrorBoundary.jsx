import React from 'react';

/** Catches render errors on master screens (mobile Safari) instead of a blank page. */
export default class MasterSlideErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Master screen error:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="slide master-slide-error">
          <h2 className="sale-bill-page__title">Screen could not open</h2>
          <p className="deploy-update-msg deploy-update-msg--err">{String(error?.message || error)}</p>
          <button type="button" className="btn btn-secondary" onClick={() => this.props.onMenu?.()}>
            ← Back to menu
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
