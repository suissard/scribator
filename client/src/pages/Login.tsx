import { Feather } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { pb } from '@/api/pocketbase';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ErrorNote } from '@/components/ui/ErrorNote';
import { Field, Input } from '@/components/ui/field';
import { MockToggle } from '@/components/layout/MockToggle';
import { getMockMode } from '@/lib/mockState';

export function Login() {
  const navigate = useNavigate();
  const isMock = getMockMode();
  const [email, setEmail] = useState(isMock ? 'demo@scribator.test' : '');
  const [password, setPassword] = useState(isMock ? 'demo-password-1234' : '');
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
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <MockToggle />
      </div>
      <Card className="w-full max-w-sm space-y-5">
        <div className="text-center">
          <Feather className="mx-auto text-accent" />
          <h1 className="mt-2 font-serif text-2xl font-semibold">Scribator</h1>
          <p className="text-sm text-muted">
            {isMock ? 'Accès Démo / Mock activé' : 'Accès sur invitation'}
          </p>
        </div>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Field label="E-mail">
            <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Mot de passe">
            <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          {isMock && (
            <p className="text-xs text-muted">
              Identifiants démo pré-remplis pour tester l'interface. Cliquez directement sur Se connecter.
            </p>
          )}
          <ErrorNote error={error} />
          <Button type="submit" className="w-full" disabled={busy}>Se connecter</Button>
        </form>
      </Card>
    </div>
  );
}
