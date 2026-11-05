import { Feather } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { pb } from '@/api/pocketbase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input } from '@/components/ui/field';

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await pb.collection('users').authWithPassword(email, password);
      navigate('/');
    } catch {
      setError('Identifiants incorrects.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <Feather className="mx-auto text-accent" />
          <h1 className="mt-2 font-serif text-2xl font-semibold">Scribator</h1>
          <p className="text-sm text-muted">Accès sur invitation</p>
        </div>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Field label="E-mail">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Mot de passe">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote error={error} />
          <Button type="submit" className="w-full" disabled={busy}>Se connecter</Button>
        </form>
      </Card>
    </div>
  );
}
