const fs = require('fs');
const path = require('path');
const gpmfExtract = require('gpmf-extract');
const goproTelemetry = require('gopro-telemetry');

const dossierInput = process.argv[2] || 'E:/DCIM/100GOPRO';
const fichierSortieCSV = path.join(dossierInput, 'telemetrie_complet.csv');

const GRAVITE = 9.80665;
const SMOOTH_FACTOR = 0.25; // Réactif pour conserver les pics à 0.8g / 1.0g

function convertirEnG(valeur) {
    if (valeur === undefined || valeur === null || isNaN(valeur)) return 0;
    if (Math.abs(valeur) > 2.5) {
        return valeur / GRAVITE;
    }
    return Number(valeur);
}

async function extraireCSV() {
    try {
        const fichiersLRV = fs.readdirSync(dossierInput)
            .filter(f => f.toUpperCase().endsWith('.LRV'))
            .sort();

        if (fichiersLRV.length === 0) {
            console.log('STATUS:Aucun fichier .LRV trouvé');
            return;
        }

        console.log(`STATUS:Analyse de ${fichiersLRV.length} fichiers .LRV...`);
        console.log('PROGRESS:5');

        let dateDebutGlobaleMs = null;
        let offsetCumuleMs = 0;

        let echantillonsPropres = [];
        let sumX = 0, sumY = 0, sumZ = 0, countZero = 0;

        for (let index = 0; index < fichiersLRV.length; index++) {
            const file = fichiersLRV[index];
            const filePath = path.join(dossierInput, file);

            console.log(`STATUS:Lecture de ${file} (${index + 1}/${fichiersLRV.length})...`);
            const pct = 5 + Math.round(((index + 1) / fichiersLRV.length) * 75);
            console.log(`PROGRESS:${pct}`);

            const fileBuffer = fs.readFileSync(filePath);
            const extracted = await gpmfExtract(fileBuffer);

            const telemetry = await goproTelemetry(extracted, {
                stream: ['GPS5', 'ACCL', 'GYRO'],
                repeatOnError: true
            });

            if (index === 0) {
                if (telemetry && telemetry['1'] && telemetry['1'].streams && telemetry['1'].streams.GPS5 && telemetry['1'].streams.GPS5.date) {
                    dateDebutGlobaleMs = new Date(telemetry['1'].streams.GPS5.date).getTime();
                } else {
                    const stats = fs.statSync(filePath);
                    dateDebutGlobaleMs = stats.birthtimeMs || stats.mtimeMs;
                }
            }

            if (telemetry && telemetry['1'] && telemetry['1'].streams) {
                const streams = telemetry['1'].streams;
                const gpsSamples = streams.GPS5 ? streams.GPS5.samples : [];
                const acclSamples = streams.ACCL ? streams.ACCL.samples : [];
                const gyroSamples = streams.GYRO ? streams.GYRO.samples : [];

                let ctsMaxDuFichierMs = 0;

                gpsSamples.forEach(gps => {
                    const ctsMs = Math.round(gps.cts || 0);
                    if (ctsMs > ctsMaxDuFichierMs) ctsMaxDuFichierMs = ctsMs;

                    const timestampAbsolu = dateDebutGlobaleMs + offsetCumuleMs + ctsMs;
                    const speed2D_ms = (gps.value && gps.value[3] !== undefined) ? gps.value[3] : 0;

                    const accl = acclSamples.find(a => Math.abs((a.cts || 0) - ctsMs) < 100) || { value: [0, 0, 0] };
                    const gyro = gyroSamples.find(g => Math.abs((g.cts || 0) - ctsMs) < 100) || { value: [0, 0, 0] };

                    const vAccl = accl.value || [0, 0, 0];
                    const vGyro = gyro.value || [0, 0, 0];

                    const rawX = convertirEnG(vAccl[0]);
                    const rawY = convertirEnG(vAccl[1]);
                    const rawZ = convertirEnG(vAccl[2]);

                    // Si le véhicule est quasi immobile (vitesse < 1.5 km/h), on accumule pour calculer la gravité au repos
                    if (speed2D_ms < 0.4) {
                        sumX += rawX;
                        sumY += rawY;
                        sumZ += rawZ;
                        countZero++;
                    }

                    echantillonsPropres.push({
                        timeISO: new Date(timestampAbsolu).toISOString(),
                        lat: (gps.value && gps.value[0] !== undefined) ? gps.value[0] : '',
                        lon: (gps.value && gps.value[1] !== undefined) ? gps.value[1] : '',
                        ele: (gps.value && gps.value[2] !== undefined) ? gps.value[2] : '',
                        speedKMH: (speed2D_ms * 3.6).toFixed(2),
                        rawX, rawY, rawZ,
                        gyroX: vGyro[0] !== undefined ? Number(vGyro[0]).toFixed(2) : '0',
                        gyroY: vGyro[1] !== undefined ? Number(vGyro[1]).toFixed(2) : '0',
                        gyroZ: vGyro[2] !== undefined ? Number(vGyro[2]).toFixed(2) : '0'
                    });
                });

                offsetCumuleMs += ctsMaxDuFichierMs;
            }
        }

        // Calcul du vecteur gravité au repos
        const biasX = countZero > 0 ? sumX / countZero : 0;
        const biasY = countZero > 0 ? sumY / countZero : 0;
        const biasZ = countZero > 0 ? sumZ / countZero : 1.0;

        console.log('STATUS:Génération du CSV avec accéléromètre haute fréquence étalonné...');
        console.log('PROGRESS:85');

        let lignesCSV = [];
        lignesCSV.push('GPS Time,GPS Latitude,GPS Longitude,GPS Altitude,GPS Speed,G_Longitudinal,G_Lateral,Accelerometer X,Accelerometer Y,Accelerometer Z,Gyroscope X,Gyroscope Y,Gyroscope Z');

        let sX = 0, sY = 0, sZ = 0;
        let init = false;

        echantillonsPropres.forEach(pt => {
            // Soustraction exacte du biais de repos (retire le 1G de gravité et l'inclinaison)
            const netX = pt.rawX - biasX;
            const netY = pt.rawY - biasY;
            const netZ = pt.rawZ - biasZ;

            // Lissage léger pour garder la dynamique réelle tout en retirant le bruit
            if (!init) {
                sX = netX; sY = netY; sZ = netZ;
                init = true;
            } else {
                sX = sX + SMOOTH_FACTOR * (netX - sX);
                sY = sY + SMOOTH_FACTOR * (netY - sY);
                sZ = sZ + SMOOTH_FACTOR * (netZ - sZ);
            }

            lignesCSV.push([
                pt.timeISO,
                pt.lat,
                pt.lon,
                pt.ele,
                pt.speedKMH,
                sY.toFixed(2), // Accélération / Freinage (+/-) réactif (jusqu'à 0.8g/1g)
                sX.toFixed(2), // Virages (+/-)
                sX.toFixed(2), // Accelerometer X (sans 1G à l'arrêt)
                sY.toFixed(2), // Accelerometer Y (sans 1G à l'arrêt)
                sZ.toFixed(2), // Accelerometer Z (0.00 à l'arrêt)
                pt.gyroX,
                pt.gyroY,
                pt.gyroZ
            ].join(','));
        });

        console.log('PROGRESS:95');
        fs.writeFileSync(fichierSortieCSV, lignesCSV.join('\n'), 'utf8');

        console.log('PROGRESS:100');
        console.log('STATUS:Terminé ! Fichier telemetrie_complet.csv créé.');

    } catch (error) {
        console.error(error);
    }
}

extraireCSV();