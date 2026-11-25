# Le boutisme (*Endianness*)

## Définition

Le **boutisme** (*endianness* en anglais) désigne la manière dont un nombre est stocké sur plusieurs octets en mémoire.  
Cela correspond à l'ordre d'enregistrement des octets, du poids fort au poids faible (ou inversement).

---

## Les conventions

**Exemple utilisé :** le nombre `54332`, soit `0x0000D43C` en hexadécimal (sur 4 octets / 32 bits).

### Gros-boutisme (*Big-endian*)

L'octet de **poids fort** est stocké en premier (à l'adresse mémoire la plus faible).

| Adresse (offset) | `+0` | `+1` | `+2` | `+3` |
| :--- | :---: | :---: | :---: | :---: |
| **Big-endian** | `00` | `00` | `D4` | `3C` |

**Exemples d'utilisation :**
- **Protocoles réseau :** suite **TCP/IP** (IPv4, IPv6, TCP, UDP — appelé *network byte order*), DNS.
- **Architectures et OS :** processeurs Motorola 68k, SPARC, anciens PowerPC (ex. : anciens systèmes Unix/macOS PowerPC, routeurs réseau).
- **Formats de fichiers :** PNG, JPEG, bytecode Java (`.class`).

### Petit-boutisme (*Little-endian*)

L'octet de **poids faible** est stocké en premier (à l'adresse mémoire la plus faible).

| Adresse (offset) | `+0` | `+1` | `+2` | `+3` |
| :--- | :---: | :---: | :---: | :---: |
| **Little-endian** | `3C` | `D4` | `00` | `00` |

**Exemples d'utilisation :**
- **Architectures et OS :** processeurs **x86 / x86-64** (Windows, Linux, macOS Intel) et **ARM** en mode par défaut (Android, iOS, macOS Apple Silicon, Raspberry Pi).
- **Bus et protocoles matériels :** **PCIe** (PCI Express), USB, SATA, NVMe.
- **Formats de fichiers :** BMP, WAV, exécutables Windows (PE) et Linux x86/ARM (ELF).

---

### Bi-boutisme (*Bi-endianness*)

Si certaines architectures ont un boutisme fixe (par exemple **x86 / x86-64**, toujours en *little-endian*), d'autres sont dites **bi-boutistes** (*bi-endian*) — comme **ARM**, **PowerPC**, **MIPS** ou **SPARC v9** — et permettent de choisir entre *big-endian* et *little-endian* :

- **Au niveau matériel (*hardware*) :** via une broche de configuration au démarrage (*bootstrap pin* / signal de reset) ou un câblage/fusible sur la carte.
- **Au niveau logiciel (*software*) :** par l'OS ou le noyau via un registre de contrôle du processeur (ex. : bit `EE`/`E0E` dans le registre `SCTLR` ou instruction `SETEND` sur ARM, bit `LE` du registre `MSR` sur PowerPC), ou encore par conversion logicielle dans les applications (ex. : fonctions réseau `htonl` / `ntohl` en C).

---

### Mi-boutisme (*Middle-endian*)

Les octets ne sont rangés ni purement par poids fort ni purement par poids faible : l'ordre est **hybride** (par exemple, des mots de 16 bits rangés en *big-endian*, mais avec les octets inversés en *little-endian* à l'intérieur de chaque mot, comme sur le **PDP-11**).

| Adresse (offset) | `+0` | `+1` | `+2` | `+3` |
| :--- | :---: | :---: | :---: | :---: |
| **Middle-endian (PDP-11)** | `00` | `00` | `3C` | `D4` |

**Exemples d'utilisation :**
- **Architectures historiques :** ordinateurs **PDP-11** (DEC) pour le stockage des entiers 32 bits.
- **Flottants et systèmes embarqués :** ancien format de nombres flottants 64 bits **ARM FPA** (*Floating Point Accelerator*, mots de 32 bits inversés).
- **Protocoles industriels :** certaines implémentations **Modbus** (registres 16 bits en *big-endian*, mais ordre des mots inversé sur les valeurs 32 bits selon le constructeur).

---

## Impact et Cybersécurité

### CWE-198 : Utilisation d'un ordre d'octets incorrect

Le traitement de données sans prise en compte de l'ordre des octets (par ex. *big-endian* vs *little-endian*) entraîne l'interprétation d'une **valeur incorrecte**.

Les conséquences peuvent être critiques :
- **Accès mémoire non autorisés** (lecture ou écriture hors limites) ;
- **Contournement de contrôles** (vérification de limites, de droits ou d'identifiants) ;
- **Déni de service (DoS) / plantage** : une taille ou longueur d'objet mal interprétée peut provoquer un dépassement de mémoire ou une allocation excessive.

#### Notes
Autre CWE relative au boutisme selon les consequences: 
- CWE-787: Write Out-of-Bounds
- CWE-125: Read Out-of-Bounds
- CWE-129: Improper Validation of Array Index

### Exemples de CVE observées

Ces vulnérabilités illustrent différents impacts liés à une mauvaise gestion du boutisme (**déni de service** ou **accès mémoire hors limites**:

| CVE | Impact | Description | Référence |
| :--- | :--- | :--- | :--- |
| **CVE-2025-52980** | Déni de service | Erreur d'ordre des octets (CWE-198) dans le démon BGP `rpd` de Juniper Junos OS (SRX300) provoquant un crash. | [Fiche CVE.org](https://www.cve.org/CVERecord?id=CVE-2025-52980) |
| **CVE-2026-52920** | Déni de service / Filtrage | Mauvais ordre de traitement IPsec dans Netfilter (`xt_policy`, noyau Linux) causant un crash ou un filtrage erroné. | [Bulletin IBM](https://www.ibm.com/support/pages/node/7297421) |
| **CVE-2022-46340** | Accès mémoire hors limites | Erreur de *byte swapping* dans X.Org / Xwayland (`XTestFakeInput`) entraînant une écriture hors limites. | [Fiche CVE.org](https://www.cve.org/CVERecord?id=CVE-2022-46340) |
| **CVE-2024-31080** | Accès mémoire hors limites | Erreur de *byte swapping* dans X.Org / Xwayland (`ProcXIGetSelectedEvents`) permettant une lecture hors limites. | [Fiche CVE.org](https://www.cve.org/CVERecord?id=CVE-2024-31080) |

---

## Source

- [Wikipédia — Boutisme](https://fr.wikipedia.org/wiki/Boutisme)
- [Common Weakness Enumeration](https://cwe.mitre.org/)
- [Safeguard](https://safeguard.sh/resources/blog/cwe-198-incorrect-byte-ordering)
- [CVE-2025-52980](https://www.cve.org/CVERecord?id=CVE-2025-52980)
- [CVE-2026-52920](https://www.ibm.com/support/pages/node/7297421)
- [CVE-2022-46340](https://www.cve.org/CVERecord?id=CVE-2022-46340)
- [CVE-2024-31080](https://www.cve.org/CVERecord?id=CVE-2024-31080)

