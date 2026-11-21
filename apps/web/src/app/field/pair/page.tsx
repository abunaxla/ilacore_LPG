import { ActionForm } from '@/components/action-form';
import { getMessages } from '@/i18n';
import { pairAction } from '../actions';
import { FieldFrame } from '../field-frame';

/** One-time set-up: the handheld keeps its device credential so its users can sign in with phone and PIN. */
export default function PairPage() {
  const f = getMessages().field;
  return (
    <FieldFrame title={f.pairTitle}>
      <p className="mb-5">{f.pairIntro}</p>
      <ActionForm action={pairAction} label={f.pair} working={f.pairing}>
        <div className="flex flex-col gap-1">
          <label htmlFor="credential" className="font-semibold">{f.credential}</label>
          <textarea
            id="credential"
            name="credential"
            required
            rows={4}
            autoComplete="off"
            spellCheck={false}
            className="block w-full rounded-md border-2 border-current bg-transparent px-3 py-2 font-mono text-base"
          />
        </div>
      </ActionForm>
    </FieldFrame>
  );
}
