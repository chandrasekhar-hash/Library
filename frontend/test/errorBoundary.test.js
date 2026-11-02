import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AksErrorBoundary } from '../src/components/AksErrorBoundary.js';

describe('ISSUE-ARCH-01: AksErrorBoundary Component Test Suite', () => {
  test('1. Initial state has no error', () => {
    const boundary = new AksErrorBoundary({});
    assert.equal(boundary.state.hasError, false);
    assert.equal(boundary.state.error, null);
    assert.equal(boundary.state.errorId, null);
  });

  test('2. getDerivedStateFromError captures error and generates reference ID', () => {
    const mockError = new Error('Simulated Canvas Render Overflow');
    const state = AksErrorBoundary.getDerivedStateFromError(mockError);

    assert.equal(state.hasError, true);
    assert.equal(state.error, mockError);
    assert.ok(state.errorId, 'Must generate a unique errorId string');
    assert.equal(typeof state.errorId, 'string');
  });

  test('3. componentDidCatch invokes onError callback with error details', () => {
    let capturedError = null;
    let capturedInfo = null;

    const boundary = new AksErrorBoundary({
      onError: (err, info) => {
        capturedError = err;
        capturedInfo = info;
      },
    });
    boundary.state = AksErrorBoundary.getDerivedStateFromError(new Error('Test Error'));

    const error = new Error('Test Component Failure');
    const errorInfo = { componentStack: '\n    in ProblematicComponent\n    in ReaderPage' };

    boundary.componentDidCatch(error, errorInfo);

    assert.equal(capturedError, error);
    assert.equal(capturedInfo, errorInfo);
  });

  test('4. handleReset clears error state and allows recovery', () => {
    const boundary = new AksErrorBoundary({});
    boundary.state = {
      hasError: true,
      error: new Error('Recoverable Error'),
      errorId: 'err-123',
    };

    boundary.handleReset();

    assert.equal(boundary.state.hasError, false);
    assert.equal(boundary.state.error, null);
    assert.equal(boundary.state.errorId, null);
  });

  test('5. render returns children when no error has occurred', () => {
    const boundary = new AksErrorBoundary({ children: 'Sanctuary Content' });
    boundary.state = { hasError: false, error: null, errorId: null };

    const rendered = boundary.render();
    assert.equal(rendered, 'Sanctuary Content');
  });

  test('6. render invokes custom fallback function when provided', () => {
    let fallbackInvoked = false;
    let fallbackArgError = null;

    const customFallback = ({ error }) => {
      fallbackInvoked = true;
      fallbackArgError = error;
      return 'Custom Fallback Content';
    };

    const boundary = new AksErrorBoundary({ fallback: customFallback });
    const mockError = new Error('Custom Error');
    boundary.state = { hasError: true, error: mockError, errorId: 'custom-err' };

    const rendered = boundary.render();
    assert.equal(fallbackInvoked, true);
    assert.equal(fallbackArgError, mockError);
    assert.equal(rendered, 'Custom Fallback Content');
  });
});
