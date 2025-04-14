import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase'; // Ensure this points to your Firebase configuration

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/'); // Redirect to the main page after login
    } catch (error) {
      setError('Failed to log in. Please check your credentials.');
    }
  };

  const handleDemoLogin = async () => {
    try {
      // Automatically log in the demo user
      await signInWithEmailAndPassword(auth, 'demo@demo.com', 'demo_demo');
      // After successful login, redirect to the desired URL
      window.location.href = 'https://genai-radiology.web.app/generative-ai?StudyInstanceUIDs=1.3';
    } catch (error) {
      setError('Failed to log in as demo user.');
      console.error('Failed to log in as demo user:', error);
    }
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Login</h2>
      <form
        onSubmit={handleLogin}
        style={styles.form}
      >
        <div style={styles.inputContainer}>
          <label
            htmlFor="email"
            style={styles.label}
          >
            Email
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={styles.input}
          />
        </div>
        <div style={styles.inputContainer}>
          <label
            htmlFor="password"
            style={styles.label}
          >
            Password
          </label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={styles.input}
          />
        </div>
        {error && <p style={styles.error}>{error}</p>}
        <button
          type="submit"
          style={styles.button}
        >
          Log In
        </button>
      </form>

      <button
        onClick={handleDemoLogin}
        style={styles.demoButton}
      >
        Try Demo Mode
      </button>

      <p style={styles.label}>
        Don't have an account?{' '}
        <button
          style={{
            ...styles.button,
            backgroundColor: 'transparent',
            color: '#008aff',
            textDecoration: 'underline',
          }}
          onClick={() => navigate('/signup')}
        >
          Sign Up
        </button>
      </p>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    backgroundColor: '#1c1e2e',
  },
  title: {
    fontSize: '32px',
    color: '#ffffff',
    marginBottom: '20px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    width: '300px',
  },
  inputContainer: {
    marginBottom: '20px',
  },
  label: {
    color: '#ffffff',
    marginBottom: '5px',
    display: 'block',
  },
  input: {
    width: '100%',
    padding: '10px',
    borderRadius: '4px',
    border: '1px solid #3a3f55',
    backgroundColor: '#23273a',
    color: '#ffffff',
  },
  button: {
    padding: '10px',
    borderRadius: '4px',
    backgroundColor: '#008aff',
    color: '#ffffff',
    border: 'none',
    cursor: 'pointer',
  },
  demoButton: {
    padding: '10px',
    borderRadius: '4px',
    backgroundColor: '#ff8c00',
    color: '#ffffff',
    border: 'none',
    cursor: 'pointer',
    marginTop: '20px',
  },
  error: {
    color: 'red',
    marginBottom: '20px',
  },
};

export default Login;
