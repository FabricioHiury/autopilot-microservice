import axios from 'axios';
import { WhatsappOfficialService } from './whatsapp-official.service';
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
jest.mock('axios');
let ffmpegAvailable = true;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  ffmpegAvailable = false;
}
(ffmpegAvailable ? describe : describe.skip)(
  'Official WhatsApp voice conversion with system FFmpeg',
  () => {
    it('produces OGG/Opus and cleans up temporary inputs and outputs', async () => {
      const fixture = mkdtempSync(join(tmpdir(), 'autopilot-audio-fixture-'));
      try {
        const path = join(fixture, 'voice.wav');
        execFileSync(
          'ffmpeg',
          ['-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.1', path],
          { stdio: 'ignore' },
        );
        (axios.get as jest.Mock).mockResolvedValue({
          data: readFileSync(path),
        });
        const firebase = {
          uploadBufferToPath: jest
            .fn()
            .mockResolvedValue(['key', 'https://storage.test/voice.ogg']),
        };
        const service = new WhatsappOfficialService(
          {} as any,
          {} as any,
          {} as any,
          firebase as any,
        );
        const before = readdirSync('/tmp').filter(
          (name) =>
            name.startsWith('audio_input_') || name.startsWith('audio_output_'),
        );
        expect(
          await (service as any).convertAudioToOpus(
            'https://media.test/voice.wav',
            'store',
          ),
        ).toBe('https://storage.test/voice.ogg');
        const buffer = firebase.uploadBufferToPath.mock.calls[0][0] as Buffer;
        expect(buffer.subarray(0, 4).toString()).toBe('OggS');
        expect(buffer.includes(Buffer.from('OpusHead'))).toBe(true);
        expect(firebase.uploadBufferToPath.mock.calls[0][1]).toBe(
          'audio/ogg; codecs=opus',
        );
        expect(
          readdirSync('/tmp').filter(
            (name) =>
              name.startsWith('audio_input_') ||
              name.startsWith('audio_output_'),
          ),
        ).toEqual(before);
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  },
);
