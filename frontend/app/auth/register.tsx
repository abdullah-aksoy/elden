import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/contexts/AuthContext';
import { API_BASE_URL } from '../../src/services/api';

function registerErrorMessage(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { detail?: unknown } }; code?: string; message?: string };
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string') {
    if (detail.toLowerCase().includes('already') || detail.includes('kayıtlı')) {
      return 'Bu e-posta adresi zaten kayıtlı.';
    }
    return detail;
  }
  if (Array.isArray(detail) && detail[0] && typeof (detail[0] as { msg?: string }).msg === 'string') {
    return (detail as { msg: string }[]).map((x) => x.msg).join(' ');
  }
  if (e?.code === 'ERR_NETWORK' || e?.message === 'Network Error') {
    return `Bağlantı kurulamadı. API: ${API_BASE_URL}`;
  }
  return 'Kayıt oluşturulamadı. Tekrar deneyin.';
}

export default function RegisterScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const { register, login } = useAuth();
  const router = useRouter();

  const goToLogin = () => router.replace('/auth/login');

  const clearError = useCallback(() => setErrorText(null), []);

  const handleRegister = async () => {
    setErrorText(null);
    if (!name || !email || !password) {
      setErrorText('Ad, e-posta ve şifre zorunludur.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorText('Şifreler eşleşmiyor.');
      return;
    }

    if (password.length < 6) {
      setErrorText('Şifre en az 6 karakter olmalıdır.');
      return;
    }

    setLoading(true);
    try {
      await register(email.toLowerCase().trim(), password, name.trim(), phone.trim() || undefined);
      router.replace({ pathname: '/auth/login', params: { registered: '1' } });
    } catch (err) {
      // If the network failed after server-side insert, a login attempt can confirm the account exists.
      const e = err as { code?: string; message?: string };
      const isNetwork = e?.code === 'ERR_NETWORK' || e?.message === 'Network Error';
      if (isNetwork) {
        try {
          await login(email.toLowerCase().trim(), password);
          return;
        } catch {
          // fall through to show original error
        }
      }
      setErrorText(registerErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={goToLogin}>
            <Ionicons name="arrow-back" size={24} color="#333" />
          </TouchableOpacity>
          <View style={styles.logoWrap}>
            <Image
              source={require('../../assets/images/elden-logo.png')}
              style={styles.brandImage}
              resizeMode="contain"
              accessibilityLabel="Elden logosu"
            />
          </View>
          <Text style={styles.brand}>Elden</Text>
          <Text style={styles.title}>Hesap Oluştur</Text>
          <Text style={styles.tagline}>İkinci el alım satım — ücretsiz kayıt</Text>
          <Text style={styles.subtitle}>Bilgilerinizi girin, hemen ilan verin</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputContainer}>
            <Ionicons name="person-outline" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Ad Soyad"
              placeholderTextColor="#999"
              value={name}
              onChangeText={(t) => {
                setName(t);
                clearError();
              }}
              autoComplete="name"
              maxLength={80}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="mail-outline" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="E-posta"
              placeholderTextColor="#999"
              value={email}
              onChangeText={(t) => {
                setEmail(t);
                clearError();
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              maxLength={254}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="call-outline" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Telefon (opsiyonel)"
              placeholderTextColor="#999"
              value={phone}
              onChangeText={(t) => {
                setPhone(t);
                clearError();
              }}
              keyboardType="phone-pad"
              autoComplete="tel"
              maxLength={30}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Şifre (min. 6 karakter)"
              placeholderTextColor="#999"
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                clearError();
              }}
              secureTextEntry
              autoComplete="password-new"
              maxLength={200}
            />
          </View>

          <View style={styles.inputContainer}>
            <Ionicons name="lock-closed-outline" size={20} color="#666" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Şifre Tekrar"
              placeholderTextColor="#999"
              value={confirmPassword}
              onChangeText={(t) => {
                setConfirmPassword(t);
                clearError();
              }}
              secureTextEntry
              autoComplete="password-new"
              maxLength={200}
            />
          </View>

          {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

          <TouchableOpacity
            style={[styles.registerButton, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.registerButtonText}>Kayıt Ol</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.loginLink} onPress={goToLogin}>
            <Text style={styles.loginLinkText}>
              Zaten hesabınız var mı? <Text style={styles.loginLinkBold}>Giriş yapın</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 60,
  },
  header: {
    marginBottom: 32,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#fff5f5',
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'center',
    marginBottom: 12,
    overflow: 'hidden',
  },
  brandImage: {
    width: 88,
    height: 88,
  },
  brand: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ff3b30',
    marginBottom: 4,
    letterSpacing: -0.3,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#333',
    marginBottom: 6,
  },
  tagline: {
    fontSize: 14,
    color: '#555',
    marginBottom: 8,
    lineHeight: 20,
  },
  subtitle: {
    fontSize: 15,
    color: '#888',
  },
  form: {
    width: '100%',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  registerButton: {
    backgroundColor: '#ff3b30',
    borderRadius: 12,
    height: 56,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  registerButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  loginLink: {
    marginTop: 24,
    alignItems: 'center',
  },
  loginLinkText: {
    fontSize: 14,
    color: '#666',
  },
  loginLinkBold: {
    color: '#ff3b30',
    fontWeight: '600',
  },
  errorText: {
    color: '#c62828',
    fontSize: 14,
    marginBottom: 8,
    textAlign: 'center',
  },
});
