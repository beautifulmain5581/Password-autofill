// VTOP In-Browser Neural Captcha Solver (CRNN + CTC)
// Pure JavaScript, 100% Client-Side, Zero External Dependencies, Offline-Ready

(function (global) {
  'use strict';

  const CHAR_SET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

  class VtopCaptchaSolver {
    constructor() {
      this.weightsLoaded = false;
      this.loadingPromise = null;
    }

    async loadFromExtensionUrl(relativeUrl = 'vtop_weights_int8.bin') {
      if (this.weightsLoaded) return this;
      if (this.loadingPromise) return this.loadingPromise;

      this.loadingPromise = (async () => {
        try {
          const url = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
            ? chrome.runtime.getURL(relativeUrl)
            : relativeUrl;
          const resp = await fetch(url);
          const buf = await resp.arrayBuffer();
          this.loadWeightsFromBuffer(buf);
          return this;
        } catch (err) {
          this.loadingPromise = null;
          throw err;
        }
      })();

      return this.loadingPromise;
    }

    loadWeightsFromBuffer(buffer) {
      if (this.weightsLoaded) return;

      const rawBuffer = buffer instanceof ArrayBuffer ? buffer : buffer.buffer;
      const byteOffset = buffer.byteOffset || 0;
      const byteLength = buffer.byteLength || rawBuffer.byteLength;
      let offset = 0;
      const view = new DataView(rawBuffer, byteOffset, byteLength);

      const readQuantized = (count) => {
        const scale = view.getFloat32(offset, true);
        offset += 4;
        const arr = new Float32Array(count);
        const int8View = new Int8Array(rawBuffer, byteOffset + offset, count);
        offset += count;
        for (let i = 0; i < count; i++) {
          arr[i] = int8View[i] * scale;
        }
        return arr;
      };

      const readFloats = (count) => {
        const arr = new Float32Array(count);
        for (let i = 0; i < count; i++) {
          arr[i] = view.getFloat32(offset, true);
          offset += 4;
        }
        return arr;
      };

      this.conv1_w = readQuantized(64 * 1 * 3 * 3);
      this.conv1_b = readFloats(64);
      this.conv2_w = readQuantized(128 * 64 * 3 * 3);
      this.conv2_b = readFloats(128);

      this.lstm_w_ih = readQuantized(1024 * 1536);
      this.lstm_w_hh = readQuantized(1024 * 256);
      this.lstm_b = readFloats(1024);

      this.lstm_w_ih_rev = readQuantized(1024 * 1536);
      this.lstm_w_hh_rev = readQuantized(1024 * 256);
      this.lstm_b_rev = readFloats(1024);

      this.fc_w = readQuantized(37 * 512);
      this.fc_b = readFloats(37);

      // Reusable typed array buffers for fast inference without GC pressure
      this.c1 = new Float32Array(64 * 50 * 200);
      this.p1 = new Float32Array(64 * 25 * 100);
      this.col2 = new Float32Array(576 * 2500);
      this.c2 = new Float32Array(128 * 25 * 100);
      this.p2 = new Float32Array(128 * 12 * 50);
      this.rnn_in = new Float32Array(50 * 1536);
      this.gates_fwd_x = new Float32Array(50 * 1024);
      this.gates_bwd_x = new Float32Array(50 * 1024);
      this.h_fwd = new Float32Array(50 * 256);
      this.h_bwd = new Float32Array(50 * 256);
      this.temp_gates = new Float32Array(1024);
      this.h_prev = new Float32Array(256);
      this.c_prev = new Float32Array(256);
      this.h_cat = new Float32Array(512);
      this.preds = new Int32Array(50);

      this.weightsLoaded = true;
    }

    // Extract 200x50 grayscale Float32Array [0, 1] from an HTMLImageElement or data-URL
    extractImagePixels(imgElement) {
      return new Promise((resolve, reject) => {
        const process = (img) => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = 200;
            canvas.height = 50;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, 200, 50);

            const imgData = ctx.getImageData(0, 0, 200, 50);
            const data = imgData.data;
            const pixels = new Float32Array(200 * 50);

            for (let i = 0; i < 200 * 50; i++) {
              const r = data[i * 4];
              const g = data[i * 4 + 1];
              const b = data[i * 4 + 2];
              // Standard ITU-R luminance grayscale normalized to [0, 1]
              pixels[i] = (r * 299 + g * 587 + b * 114) / 255000;
            }
            resolve(pixels);
          } catch (err) {
            reject(err);
          }
        };

        if (imgElement.complete && imgElement.naturalWidth > 0) {
          process(imgElement);
        } else {
          const tempImg = new Image();
          tempImg.crossOrigin = 'anonymous';
          tempImg.onload = () => process(tempImg);
          tempImg.onerror = (e) => reject(new Error('Failed to load captcha image: ' + e));
          tempImg.src = imgElement.src;
        }
      });
    }

    // Solve directly from DOM image element
    async solve(imgElement) {
      await this.loadFromExtensionUrl();
      const pixels = await this.extractImagePixels(imgElement);
      return this.predictGrayscale(pixels);
    }

    predictGrayscale(inputImage) {
      if (!this.weightsLoaded) {
        throw new Error("VTOP Solver weights not loaded yet");
      }

      const conv1_w = this.conv1_w;
      const conv1_b = this.conv1_b;
      const c1 = this.c1;

      // 1. Conv1: 1 -> 64, 3x3, pad 1 + ReLU
      for (let oc = 0; oc < 64; oc++) {
        const b = conv1_b[oc];
        const oc_w = oc * 9;
        const oc_base = oc * 10000;
        for (let y = 0; y < 50; y++) {
          const y_base = oc_base + y * 200;
          for (let x = 0; x < 200; x++) {
            let sum = b;
            for (let ky = 0; ky < 3; ky++) {
              const iy = y + ky - 1;
              if (iy < 0 || iy >= 50) continue;
              const row_in = iy * 200;
              const w_row = oc_w + ky * 3;
              for (let kx = 0; kx < 3; kx++) {
                const ix = x + kx - 1;
                if (ix < 0 || ix >= 200) continue;
                sum += conv1_w[w_row + kx] * inputImage[row_in + ix];
              }
            }
            c1[y_base + x] = sum > 0 ? sum : 0;
          }
        }
      }

      // 2. MaxPool1: 2x2 -> (64, 25, 100)
      const p1 = this.p1;
      for (let oc = 0; oc < 64; oc++) {
        const oc_c1 = oc * 10000;
        const oc_p1 = oc * 2500;
        for (let y = 0; y < 25; y++) {
          const y2 = y * 2;
          const row0 = oc_c1 + y2 * 200;
          const row1 = row0 + 200;
          const p1_row = oc_p1 + y * 100;
          for (let x = 0; x < 100; x++) {
            const x2 = x * 2;
            const v0 = c1[row0 + x2];
            const v1 = c1[row0 + x2 + 1];
            const v2 = c1[row1 + x2];
            const v3 = c1[row1 + x2 + 1];
            let max = v0 > v1 ? v0 : v1;
            if (v2 > max) max = v2;
            if (v3 > max) max = v3;
            p1[p1_row + x] = max;
          }
        }
      }

      // 3. Conv2: 64 -> 128, 3x3, pad 1 + ReLU via im2col
      const col2 = this.col2;
      col2.fill(0);
      for (let ic = 0; ic < 64; ic++) {
        const ic_base = ic * 2500;
        for (let ky = 0; ky < 3; ky++) {
          for (let kx = 0; kx < 3; kx++) {
            const col_row = (ic * 9 + ky * 3 + kx) * 2500;
            for (let y = 0; y < 25; y++) {
              const iy = y + ky - 1;
              if (iy < 0 || iy >= 25) continue;
              const in_row = ic_base + iy * 100;
              const out_row = col_row + y * 100;
              for (let x = 0; x < 100; x++) {
                const ix = x + kx - 1;
                if (ix >= 0 && ix < 100) {
                  col2[out_row + x] = p1[in_row + ix];
                }
              }
            }
          }
        }
      }

      const conv2_w = this.conv2_w;
      const conv2_b = this.conv2_b;
      const c2 = this.c2;

      for (let oc = 0; oc < 128; oc++) {
        const b = conv2_b[oc];
        const oc_base = oc * 2500;
        const oc_w = oc * 576;
        for (let p = 0; p < 2500; p++) {
          c2[oc_base + p] = b;
        }
        for (let k = 0; k < 576; k++) {
          const w = conv2_w[oc_w + k];
          if (w === 0) continue;
          const col_row = k * 2500;
          for (let p = 0; p < 2500; p++) {
            c2[oc_base + p] += w * col2[col_row + p];
          }
        }
        // ReLU
        for (let p = 0; p < 2500; p++) {
          const v = c2[oc_base + p];
          if (v < 0) c2[oc_base + p] = 0;
        }
      }

      // 4. MaxPool2: 2x2 on (128, 24, 100) -> (128, 12, 50)
      const p2 = this.p2;
      for (let oc = 0; oc < 128; oc++) {
        const oc_c2 = oc * 2500;
        const oc_p2 = oc * 600; // 12 * 50
        for (let y = 0; y < 12; y++) {
          const y2 = y * 2;
          const row0 = oc_c2 + y2 * 100;
          const row1 = row0 + 100;
          const p2_row = oc_p2 + y * 50;
          for (let x = 0; x < 50; x++) {
            const x2 = x * 2;
            const v0 = c2[row0 + x2];
            const v1 = c2[row0 + x2 + 1];
            const v2 = c2[row1 + x2];
            const v3 = c2[row1 + x2 + 1];
            let max = v0 > v1 ? v0 : v1;
            if (v2 > max) max = v2;
            if (v3 > max) max = v3;
            p2[p2_row + x] = max;
          }
        }
      }

      // 5. Permute to RNN input: (50 steps, 1536 features)
      const rnn_in = this.rnn_in;
      for (let t = 0; t < 50; t++) {
        const t_base = t * 1536;
        for (let idx = 0; idx < 1536; idx++) {
          rnn_in[t_base + idx] = p2[idx * 50 + t];
        }
      }

      // 6. Precompute gates_x = rnn_in @ W_ih.T + b
      const gates_fwd_x = this.gates_fwd_x;
      const gates_bwd_x = this.gates_bwd_x;
      const w_ih_fwd = this.lstm_w_ih;
      const w_ih_bwd = this.lstm_w_ih_rev;
      const b_fwd = this.lstm_b;
      const b_bwd = this.lstm_b_rev;

      for (let t = 0; t < 50; t++) {
        const in_offset = t * 1536;
        const out_offset = t * 1024;
        for (let g = 0; g < 1024; g++) {
          let sum_fwd = b_fwd[g];
          let sum_bwd = b_bwd[g];
          const w_row = g * 1536;
          for (let k = 0; k < 1536; k++) {
            const x_val = rnn_in[in_offset + k];
            sum_fwd += w_ih_fwd[w_row + k] * x_val;
            sum_bwd += w_ih_bwd[w_row + k] * x_val;
          }
          gates_fwd_x[out_offset + g] = sum_fwd;
          gates_bwd_x[out_offset + g] = sum_bwd;
        }
      }

      // 7. Forward LSTM (t = 0..49)
      const h_fwd = this.h_fwd;
      const w_hh_fwd = this.lstm_w_hh;
      const temp_gates = this.temp_gates;
      const h_prev = this.h_prev;
      const c_prev = this.c_prev;

      h_prev.fill(0);
      c_prev.fill(0);

      for (let t = 0; t < 50; t++) {
        const g_offset = t * 1024;
        for (let g = 0; g < 1024; g++) {
          let sum = gates_fwd_x[g_offset + g];
          const w_row = g * 256;
          for (let j = 0; j < 256; j++) {
            sum += w_hh_fwd[w_row + j] * h_prev[j];
          }
          temp_gates[g] = sum;
        }

        const h_offset = t * 256;
        for (let j = 0; j < 256; j++) {
          const i_gate = 1.0 / (1.0 + Math.exp(-temp_gates[j]));
          const f_gate = 1.0 / (1.0 + Math.exp(-temp_gates[256 + j]));
          const g_gate = Math.tanh(temp_gates[512 + j]);
          const o_gate = 1.0 / (1.0 + Math.exp(-temp_gates[768 + j]));

          const c_new = f_gate * c_prev[j] + i_gate * g_gate;
          const h_new = o_gate * Math.tanh(c_new);

          c_prev[j] = c_new;
          h_prev[j] = h_new;
          h_fwd[h_offset + j] = h_new;
        }
      }

      // 8. Backward LSTM (t = 49..0)
      const h_bwd = this.h_bwd;
      const w_hh_bwd = this.lstm_w_hh_rev;

      h_prev.fill(0);
      c_prev.fill(0);

      for (let t = 49; t >= 0; t--) {
        const g_offset = t * 1024;
        for (let g = 0; g < 1024; g++) {
          let sum = gates_bwd_x[g_offset + g];
          const w_row = g * 256;
          for (let j = 0; j < 256; j++) {
            sum += w_hh_bwd[w_row + j] * h_prev[j];
          }
          temp_gates[g] = sum;
        }

        const h_offset = t * 256;
        for (let j = 0; j < 256; j++) {
          const i_gate = 1.0 / (1.0 + Math.exp(-temp_gates[j]));
          const f_gate = 1.0 / (1.0 + Math.exp(-temp_gates[256 + j]));
          const g_gate = Math.tanh(temp_gates[512 + j]);
          const o_gate = 1.0 / (1.0 + Math.exp(-temp_gates[768 + j]));

          const c_new = f_gate * c_prev[j] + i_gate * g_gate;
          const h_new = o_gate * Math.tanh(c_new);

          c_prev[j] = c_new;
          h_prev[j] = h_new;
          h_bwd[h_offset + j] = h_new;
        }
      }

      // 9. FC Layer & CTC Argmax
      const fc_w = this.fc_w;
      const fc_b = this.fc_b;
      const h_cat = this.h_cat;
      const preds = this.preds;

      for (let t = 0; t < 50; t++) {
        const fwd_offset = t * 256;
        const bwd_offset = t * 256;
        for (let j = 0; j < 256; j++) {
          h_cat[j] = h_fwd[fwd_offset + j];
          h_cat[256 + j] = h_bwd[bwd_offset + j];
        }

        let max_logit = -Infinity;
        let max_idx = 0;
        for (let c = 0; c < 37; c++) {
          let sum = fc_b[c];
          const w_row = c * 512;
          for (let k = 0; k < 512; k++) {
            sum += fc_w[w_row + k] * h_cat[k];
          }
          if (sum > max_logit) {
            max_logit = sum;
            max_idx = c;
          }
        }
        preds[t] = max_idx;
      }

      // CTC Greedy Decode
      let res = "";
      let prev = -1;
      for (let t = 0; t < 50; t++) {
        const c = preds[t];
        if (c !== 0 && c !== prev) {
          res += CHAR_SET[c - 1];
        }
        prev = c;
      }

      return res;
    }
  }

  // Export for browser and node
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VtopCaptchaSolver };
  }
  if (typeof window !== 'undefined') {
    window.VtopCaptchaSolver = VtopCaptchaSolver;
  }
})(typeof window !== 'undefined' ? window : globalThis);
