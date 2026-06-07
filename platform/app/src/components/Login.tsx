import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    const checkSession = async () => {
      try {
        const response = await fetch('/auth/session', {
          method: 'GET',
          credentials: 'include',
        });

        const payload = await response.json().catch(() => null);
        const authenticated = Boolean(payload && payload.authenticated);

        if (!cancelled) {
          setIsLoggedIn(authenticated);
        }
      } catch {
        if (!cancelled) {
          setIsLoggedIn(false);
        }
      } finally {
        if (!cancelled) {
          setIsCheckingSession(false);
        }
      }
    };

    checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const response = await fetch('/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });

      if (!response.ok) {
        setError('Invalid username or password.');
        return;
      }

      navigate('/');
    } catch {
      setError('Login failed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    setIsLoggedIn(false);
  };

  if (isCheckingSession) {
    return (
      <div style={styles.container}>
        <p style={{ color: 'white' }}>Checking login status...</p>
      </div>
    );
  }

  if (isLoggedIn) {
    return (
      <div style={styles.container}>
        <div style={styles.backgroundBox}>
          <h2 style={styles.title}>You are signed in</h2>
          <button
            style={styles.button}
            onClick={() => navigate('/')}
          >
            Go to Study List
          </button>
          <button
            style={styles.logoutButton}
            onClick={handleLogout}
          >
            Log Out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.backgroundBox}>
        <h2 style={styles.title}>Study Login</h2>
        <form
          onSubmit={handleLogin}
          style={styles.form}
        >
          <div style={styles.inputContainer}>
            <label
              htmlFor="username"
              style={styles.label}
            >
              Username
            </label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
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
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Signing In...' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles = {
  backgroundBox: {
    backgroundColor: '#090C27',
    padding: '40px',
    borderRadius: '8px',
    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.3)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    width: '100%',
    backgroundColor: '#000000',
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
    color: '#78CAE3',
    marginBottom: '5px',
    display: 'block',
  },
  input: {
    width: '100%',
    padding: '10px',
    borderRadius: '4px',
    border: '1px solid #3A4194',
    backgroundColor: '#090C27',
    color: 'white',
  },
  button: {
    padding: '10px',
    borderRadius: '4px',
    backgroundColor: '#78CAE3',
    color: '#ffffff',
    border: 'none',
    cursor: 'pointer',
  },
  logoutButton: {
    padding: '10px',
    backgroundColor: '#152A66',
    color: '#ffffff',
    border: 'none',
    cursor: 'pointer',
    marginTop: '12px',
  },
  error: {
    color: 'red',
    marginBottom: '20px',
  },
};

export default Login;
