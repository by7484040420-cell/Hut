Hut-main ke andar ye 5 files REPLACE karni hain (same naam, same jagah):

1. public/sarthi-fill-engine.js        (sabse zaroori)
2. src/components/HomePortalSection.tsx
3. src/lib/nativeBrowserBridge.ts      (NAYI: ye bhi replace karo)
4. .github/workflows/build-apk.yml     (flat copy: build-apk.yml, ise .github/workflows/ me daalo)
5. server/geminiAgent.ts

Is baar kya naya:
- Address fields (Flat/Door, Road/Street, Post Office, Area/Town, District, Country, State) ab bharte hain
- Form-style wale sawal khud chunta hai (blue highlight): Address for communication = Residence,
  Residential status = Resident, Proof of DOB/ID/Address = Aadhaar, Country = India,
  Designation = Self, Upload = Manual Document Upload, Representative Assessee = No
- Income Source ab website khulne se pehle OCR screen par poochta hai
- Kuch field na bhar paye to bhi ruke nahi: Next dabata hai (Submit/Pay kabhi nahi)
- Multi-page form (3 se 6 page): har naye page par ginti dobara shuru
- Server (Render) redeploy + naya APK banana zaroori
