package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"
)

type SignRequest struct {
	Claim      map[string]interface{} `json:"claim"`
	PrivateKey string                 `json:"privateKey"`
}

type SignResponse struct {
	SignedJWT string `json:"signedJwt"`
	Error     string `json:"error,omitempty"`
}

func base64URLEncode(data []byte) string {
	return strings.TrimRight(base64.URLEncoding.EncodeToString(data), "=")
}

func signJWT(claim map[string]interface{}, privateKeyPEM string) (string, error) {
	// Parse PEM
	block, _ := pem.Decode([]byte(privateKeyPEM))
	if block == nil {
		return "", fmt.Errorf("failed to parse PEM")
	}
	key, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		// Try PKCS1
		key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		if err != nil {
			return "", fmt.Errorf("failed to parse private key: %v", err)
		}
	}
	rsaKey, ok := key.(*rsa.PrivateKey)
	if !ok {
		return "", fmt.Errorf("not an RSA key")
	}

	// Build header + payload
	header := map[string]string{"alg": "RS256", "typ": "JWT"}
	headerJSON, _ := json.Marshal(header)
	payloadJSON, _ := json.Marshal(claim)

	headerEnc := base64URLEncode(headerJSON)
	payloadEnc := base64URLEncode(payloadJSON)

	signingInput := headerEnc + "." + payloadEnc

	// Sign
	hashed := sha256.Sum256([]byte(signingInput))
	sig, err := rsa.SignPKCS1v15(rand.Reader, rsaKey, crypto.SHA256, hashed[:])
	if err != nil {
		return "", fmt.Errorf("signing failed: %v", err)
	}

	sigEnc := base64URLEncode(sig)
	return signingInput + "." + sigEnc, nil
}

func handler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(SignResponse{Error: "POST only"})
		return
	}

	var req SignRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SignResponse{Error: "bad JSON: " + err.Error()})
		return
	}

	jwt, err := signJWT(req.Claim, req.PrivateKey)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(SignResponse{Error: err.Error()})
		return
	}

	json.NewEncoder(w).Encode(SignResponse{SignedJWT: jwt})
}

func main() {
	http.HandleFunc("/sign", handler)
	log.Printf("RS256 signer listening on 127.0.0.1:9999")
	srv := &http.Server{
		Addr:         "127.0.0.1:9999", // localhost only — never expose the private key signer
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}
