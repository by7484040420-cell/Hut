import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Plus, Save, Trash2, Upload } from 'lucide-react';
import type { EphemeralDocumentExtract, ProfileVault } from '../types';
import { getVaultCompletion } from '../lib/format';
import { apiFetchJson, BackendUnavailableError } from '../lib/api';
import { INDIAN_STATES_AND_UTS, resolveIndianState } from '../lib/indianStates';
import { runNativeOnDeviceOcr } from '../lib/nativeBrowserBridge';

interface ProfileVaultSectionProps {
  profile: ProfileVault;
  onProfileSaved: (profile: ProfileVault) => void;
}

export const ProfileVaultSection: React.FC<ProfileVaultSectionProps> = ({
  profile,
  onProfileSaved,
}) => {
  const [form, setForm] = useState<ProfileVault>(profile);
  const [saving, setSaving] = useState(false);
  const [savedFlag, setSavedFlag] = useState(false);
  const [scanningOcr, setScanningOcr] = useState(false);
  const [ocrNotice, setOcrNotice] = useState<string | null>(null);
  const ocrInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setForm(profile);
  }, [profile]);

  const completion = getVaultCompletion(form);

  const updateField = (key: keyof ProfileVault, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedFlag(false);
  };

  const applyOcrToVault = (extracted: EphemeralDocumentExtract) => {
    setForm((prev) => {
      const next = { ...prev };
      for (const f of extracted.fields) {
        const k = f.key.toLowerCase();
        const l = f.label.toLowerCase();
        const v = f.value.trim();
        if (!v) continue;

        if (k === 'fullname' || (l.includes('name') && !l.includes('father') && !l.includes('mother') && !l.includes('board'))) {
          if (!next.fullName) next.fullName = v;
        } else if (k.includes('father') || l.includes('father')) {
          if (!next.fatherName) next.fatherName = v;
        } else if (k.includes('mother') || l.includes('mother')) {
          if (!next.motherName) next.motherName = v;
        } else if (k === 'dob' || l.includes('birth')) {
          if (!next.dob) {
            const ddmmyyyy = v.match(/^(\d{2})[/\-.](\d{2})[/\-.](\d{4})$/);
            next.dob = ddmmyyyy ? `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}` : v;
          }
        } else if (k === 'gender' || l.includes('gender') || l.includes('sex')) {
          if (!next.gender) next.gender = v;
        } else if (k === 'mobile' || l.includes('mobile') || l.includes('phone')) {
          if (!next.mobile) next.mobile = v.replace(/\D/g, '').slice(-10);
        } else if (k === 'email' || l.includes('email')) {
          if (!next.email) next.email = v;
        } else if (k.includes('address') || l.includes('address')) {
          if (!next.addressLine) next.addressLine = v;
        } else if (k.includes('village') || l.includes('village') || l.includes('ward')) {
          if (!next.villageOrWard) next.villageOrWard = v;
        } else if (k.includes('post') || l.includes('post office')) {
          if (!next.postOffice) next.postOffice = v;
        } else if (k.includes('police') || l.includes('thana')) {
          if (!next.policeStation) next.policeStation = v;
        } else if (k.includes('block') || k.includes('tehsil') || l.includes('tehsil')) {
          if (!next.blockOrTehsil) next.blockOrTehsil = v;
        } else if (k.includes('district') || l.includes('district')) {
          if (!next.district) next.district = v;
        } else if (k === 'state' || l === 'state' || l.includes('rajya')) {
          next.state = v;
        } else if (k.includes('pin') || l.includes('pin')) {
          if (!next.pinCode) next.pinCode = v.replace(/\D/g, '').slice(0, 6);
        } else if (k.includes('pan') || l.includes('pan')) {
          if (!next.panNumber) next.panNumber = v.toUpperCase();
        } else if (k.includes('aadhaar') || l.includes('aadhaar')) {
          if (!next.aadhaarLast4) next.aadhaarLast4 = v.replace(/\D/g, '').slice(-4);
        } else if (k.includes('passport') || l.includes('passport')) {
          if (!next.passportNumber) next.passportNumber = v.toUpperCase();
        } else if (k.includes('dl') || l.includes('driving')) {
          if (!next.dlNumber) next.dlNumber = v.toUpperCase();
        } else if (k.includes('voter') || l.includes('voter')) {
          if (!next.voterId) next.voterId = v.toUpperCase();
        }
      }
      const inferredState = resolveIndianState({
        state: next.state,
        addressLine: next.addressLine,
        pinCode: next.pinCode,
        district: next.district,
      });
      if (inferredState) {
        next.state = inferredState;
      }
      return next;
    });
    setSavedFlag(false);
  };

  const handleOcrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setScanningOcr(true);
    setOcrNotice(null);
    try {
      let extracted: EphemeralDocumentExtract | null = null;
      try {
        const formData = new FormData();
        formData.append('document', file);
        const data = await apiFetchJson<{ extracted: EphemeralDocumentExtract }>(
          '/api/ocr/extract',
          { method: 'POST', body: formData }
        );
        extracted = data.extracted;
      } catch (serverErr) {
        const nativeExtracted = await runNativeOnDeviceOcr(file);
        if (!nativeExtracted) throw serverErr;
        extracted = nativeExtracted;
      }
      applyOcrToVault(extracted);
      setOcrNotice(
        `${extracted.documentType} se ${extracted.fields.length} fields fill hue — neeche verify karke "Save Vault" dabayein.`
      );
    } catch (err) {
      setOcrNotice(err instanceof Error ? err.message : 'Document scan failed.');
    } finally {
      setScanningOcr(false);
    }
  };

  const addCustomField = () => {
    setForm((prev) => ({
      ...prev,
      customFields: [
        ...(prev.customFields || []),
        { id: `cf-${Date.now()}`, label: '', value: '' },
      ],
    }));
  };

  const updateCustomField = (id: string, key: 'label' | 'value', val: string) => {
    setForm((prev) => ({
      ...prev,
      customFields: (prev.customFields || []).map((cf) =>
        cf.id === id ? { ...cf, [key]: val } : cf
      ),
    }));
    setSavedFlag(false);
  };

  const removeCustomField = (id: string) => {
    setForm((prev) => ({
      ...prev,
      customFields: (prev.customFields || []).filter((cf) => cf.id !== id),
    }));
    setSavedFlag(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await apiFetchJson<{ profile?: ProfileVault }>('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (data.profile) {
        onProfileSaved(data.profile);
        setSavedFlag(true);
        setTimeout(() => setSavedFlag(false), 2200);
      }
    } catch (err) {
      if (err instanceof BackendUnavailableError) {
        onProfileSaved({ ...form, updatedAt: new Date().toISOString() });
        setSavedFlag(true);
        setTimeout(() => setSavedFlag(false), 2200);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <input
        ref={ocrInputRef}
        type="file"
        accept="image/*,.pdf"
        onChange={handleOcrUpload}
        className="hidden"
      />

      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-bold text-slate-900">
              Personal &amp; Document Auto-Fill Vault
            </h1>
            <p className="text-xs text-slate-600 mt-0.5">
              Aadhaar / PAN / Marksheet scan karke details auto-fill karein — ya manually save karein.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="text-right mr-1">
              <div className="text-xs font-mono font-semibold text-emerald-700 tabular-nums">
                {completion.filled}/{completion.total} core fields
              </div>
              <div className="text-[11px] text-slate-500">Ready for auto-fill</div>
            </div>
            <button
              type="button"
              disabled={scanningOcr}
              onClick={() => ocrInputRef.current?.click()}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-sky-50 border border-sky-200 hover:bg-sky-100 text-sky-900 font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              {scanningOcr ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              {scanningOcr ? 'Scanning OCR...' : 'Scan Aadhaar / Doc'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[42px] px-5 py-2 rounded-xl bg-[#0B1120] hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : savedFlag ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {savedFlag ? 'Saved!' : 'Save Vault'}
            </button>
          </div>
        </div>

        {ocrNotice && (
          <div className="px-3.5 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
            {ocrNotice}
          </div>
        )}
      </div>

      {/* Personal & Family */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
        <h2 className="text-sm font-bold text-slate-900">Personal &amp; Family Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          <FieldInput label="Full Name (as per Aadhaar)" value={form.fullName} onChange={(v) => updateField('fullName', v)} placeholder="e.g. Rahul Kumar Sharma" />
          <FieldInput label="Father's Name" value={form.fatherName} onChange={(v) => updateField('fatherName', v)} placeholder="e.g. Rajeshwar Sharma" />
          <FieldInput label="Mother's Name" value={form.motherName} onChange={(v) => updateField('motherName', v)} placeholder="e.g. Sunita Devi" />
          <FieldInput label="Date of Birth" type="date" value={form.dob} onChange={(v) => updateField('dob', v)} />
          <FieldInput label="Gender" value={form.gender} onChange={(v) => updateField('gender', v)} placeholder="Male / Female / Other" />
          <FieldInput label="Category" value={form.category} onChange={(v) => updateField('category', v)} placeholder="General / OBC / EWS / SC / ST" />
          <FieldInput label="Marital Status" value={form.maritalStatus} onChange={(v) => updateField('maritalStatus', v)} placeholder="Unmarried / Married" />
          <FieldInput label="Mobile Number" value={form.mobile} onChange={(v) => updateField('mobile', v)} placeholder="10-digit mobile" />
          <FieldInput label="Email Address" type="email" value={form.email} onChange={(v) => updateField('email', v)} placeholder="name@example.com" />
        </div>
      </div>

      {/* Address */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
        <h2 className="text-sm font-bold text-slate-900">
          Permanent Address (Block / Tehsil / Court Ready)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          <FieldInput label="House / Street / Address Line" value={form.addressLine} onChange={(v) => updateField('addressLine', v)} placeholder="House No, Mohalla / Road" />
          <FieldInput label="Village / Ward" value={form.villageOrWard} onChange={(v) => updateField('villageOrWard', v)} placeholder="Gram / Ward No." />
          <FieldInput label="Post Office (PO)" value={form.postOffice} onChange={(v) => updateField('postOffice', v)} placeholder="Post Office" />
          <FieldInput label="Police Station (Thana)" value={form.policeStation} onChange={(v) => updateField('policeStation', v)} placeholder="Thana" />
          <FieldInput label="Block / Tehsil / Anchal" value={form.blockOrTehsil} onChange={(v) => updateField('blockOrTehsil', v)} placeholder="Block / Tehsil" />
          <FieldInput label="District" value={form.district} onChange={(v) => updateField('district', v)} placeholder="District" />
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              State / Rajya
            </label>
            <select
              value={form.state}
              onChange={(e) => updateField('state', e.target.value)}
              className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-sm text-slate-900"
            >
              <option value="">-- Select State / Rajya --</option>
              {INDIAN_STATES_AND_UTS.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
              {form.state && !INDIAN_STATES_AND_UTS.includes(form.state) && (
                <option value={form.state}>{form.state}</option>
              )}
            </select>
          </div>
          <FieldInput
            label="PIN Code"
            value={form.pinCode}
            onChange={(v) => {
              const cleaned = v.replace(/\D/g, '').slice(0, 6);
              updateField('pinCode', cleaned);
              if (cleaned.length === 6 && !form.state) {
                const st = resolveIndianState({ pinCode: cleaned });
                if (st) updateField('state', st);
              }
            }}
            placeholder="6-digit PIN"
          />
        </div>
      </div>

      {/* Education & Official IDs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900">Education (Job Forms)</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <FieldInput label="Highest Qualification" value={form.qualification} onChange={(v) => updateField('qualification', v)} placeholder="10th / 12th / Graduate / B.Tech" />
            <FieldInput label="Board / University" value={form.boardOrUniversity} onChange={(v) => updateField('boardOrUniversity', v)} placeholder="CBSE / BSEB / DU..." />
            <FieldInput label="Passing Year" value={form.passingYear} onChange={(v) => updateField('passingYear', v)} placeholder="e.g. 2022" />
            <FieldInput label="Percentage / CGPA" value={form.percentageOrGrade} onChange={(v) => updateField('percentageOrGrade', v)} placeholder="e.g. 76%" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4">
          <h2 className="text-sm font-bold text-slate-900">Detailed Education &amp; Personal</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <FieldInput label="Blood Group" value={form.bloodGroup} onChange={(v) => updateField('bloodGroup', v)} placeholder="e.g. B+" />
            <FieldInput label="Place of Birth" value={form.birthPlace} onChange={(v) => updateField('birthPlace', v)} placeholder="e.g. Patna, Bihar" />
            <FieldInput label="10th Board" value={form.tenthBoard} onChange={(v) => updateField('tenthBoard', v)} placeholder="e.g. BSEB Patna" />
            <FieldInput label="10th Roll No" value={form.tenthRoll} onChange={(v) => updateField('tenthRoll', v)} placeholder="e.g. 201402891" />
            <FieldInput label="10th Passing Year" value={form.tenthYear} onChange={(v) => updateField('tenthYear', v)} placeholder="e.g. 2014" />
            <FieldInput label="10th Percentage" value={form.tenthPercent} onChange={(v) => updateField('tenthPercent', v)} placeholder="e.g. 82.4%" />
            <FieldInput label="12th Board" value={form.twelfthBoard} onChange={(v) => updateField('twelfthBoard', v)} placeholder="e.g. BSEB Patna" />
            <FieldInput label="12th Roll No" value={form.twelfthRoll} onChange={(v) => updateField('twelfthRoll', v)} placeholder="e.g. 201604128" />
            <FieldInput label="12th Passing Year" value={form.twelfthYear} onChange={(v) => updateField('twelfthYear', v)} placeholder="e.g. 2016" />
            <FieldInput label="12th Percentage" value={form.twelfthPercent} onChange={(v) => updateField('twelfthPercent', v)} placeholder="e.g. 79.6%" />
            <FieldInput label="12th Stream" value={form.twelfthStream} onChange={(v) => updateField('twelfthStream', v)} placeholder="e.g. Science (PCM)" />
            <FieldInput label="Graduation Degree" value={form.graduationDegree} onChange={(v) => updateField('graduationDegree', v)} placeholder="e.g. B.Sc Computer Science" />
            <FieldInput label="College / University" value={form.collegeName} onChange={(v) => updateField('collegeName', v)} placeholder="e.g. Patna University" />
            <FieldInput label="Graduation Year" value={form.graduationYear} onChange={(v) => updateField('graduationYear', v)} placeholder="e.g. 2020" />
            <FieldInput label="Graduation Percentage" value={form.graduationPercent} onChange={(v) => updateField('graduationPercent', v)} placeholder="e.g. 78.2%" />
          </div>
        </div>

        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-4 lg:col-span-2">
          <h2 className="text-sm font-bold text-slate-900">Official IDs &amp; Travel</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
            <FieldInput label="PAN Number" value={form.panNumber} onChange={(v) => updateField('panNumber', v.toUpperCase())} placeholder="ABCDE1234F (if issued)" />
            <FieldInput label="Aadhaar Last 4 Digits" value={form.aadhaarLast4} onChange={(v) => updateField('aadhaarLast4', v)} placeholder="e.g. 4829" />
            <FieldInput label="Passport Number" value={form.passportNumber} onChange={(v) => updateField('passportNumber', v.toUpperCase())} placeholder="If already issued" />
            <FieldInput label="Driving License (DL) No." value={form.dlNumber} onChange={(v) => updateField('dlNumber', v.toUpperCase())} placeholder="If already issued" />
            <FieldInput label="Voter ID (EPIC)" value={form.voterId} onChange={(v) => updateField('voterId', v.toUpperCase())} placeholder="Optional" />
            <FieldInput label="Home Railway / Airport City" value={form.preferredDepartureCity} onChange={(v) => updateField('preferredDepartureCity', v)} placeholder="e.g. Patna / Lucknow" />
          </div>
        </div>
      </div>

      {/* Custom Fields */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Extra Custom Fields</h2>
            <p className="text-xs text-slate-600">
              Add Bank IFSC, Income Certificate No., Caste Certificate No., or Roll Number for AI auto-fill.
            </p>
          </div>
          <button
            type="button"
            onClick={addCustomField}
            className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-slate-50 border border-slate-200 hover:border-slate-400 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-700" />
            Add Field
          </button>
        </div>

        {(form.customFields || []).length > 0 && (
          <div className="space-y-2">
            {form.customFields.map((cf) => (
              <div key={cf.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                <input
                  type="text"
                  value={cf.label}
                  onChange={(e) => updateCustomField(cf.id, 'label', e.target.value)}
                  placeholder="Field Name (e.g. Bank IFSC)"
                  className="flex-1 min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900"
                />
                <input
                  type="text"
                  value={cf.value}
                  onChange={(e) => updateCustomField(cf.id, 'value', e.target.value)}
                  placeholder="Value"
                  className="flex-1 min-h-[40px] px-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => removeCustomField(cf.id)}
                  aria-label="Remove custom field"
                  className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-200 text-slate-400 hover:text-rose-600 flex items-center justify-center"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </form>
  );
};

interface FieldInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}

const FieldInput: React.FC<FieldInputProps> = ({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}) => (
  <div>
    <label className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full min-h-[42px] px-3.5 rounded-xl bg-slate-50 border border-slate-200 focus:border-slate-900 focus:bg-white focus:outline-none text-sm text-slate-900 placeholder:text-slate-400"
    />
  </div>
);
