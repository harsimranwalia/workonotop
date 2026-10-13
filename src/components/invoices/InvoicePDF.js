import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font, Image } from '@react-pdf/renderer';

// Register fonts for a more professional look
Font.register({
  family: 'Helvetica',
  fonts: [
    { src: 'https://cdn.jsdelivr.net/npm/@canvas-fonts/helvetica@1.0.4/Helvetica.ttf' },
    { src: 'https://cdn.jsdelivr.net/npm/@canvas-fonts/helvetica@1.0.4/Helvetica-Bold.ttf', fontWeight: 'bold' }
  ]
});

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: 'Helvetica',
    fontSize: 10,
    color: '#333',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingBottom: 20,
  },
  brand: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#115e59', // PRIMARY color
  },
  logo: {
    width: 130,
    height: 35,
    objectFit: 'contain',
  },
  brandSpan: {
    color: '#333',
  },
  invoiceMeta: {
    textAlign: 'right',
  },
  invoiceTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#115e59',
    textTransform: 'uppercase',
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 5,
  },
  grid: {
    flexDirection: 'row',
    gap: 20,
  },
  col: {
    flex: 1,
  },
  label: {
    color: '#64748b',
    fontSize: 9,
    marginBottom: 2,
  },
  value: {
    fontWeight: 'bold',
    marginBottom: 8,
  },
  table: {
    marginTop: 10,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 2,
    borderBottomColor: '#333',
    paddingBottom: 5,
    marginBottom: 10,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 10,
  },
  tableColDesc: {
    flex: 3,
  },
  tableColAmount: {
    flex: 1,
    textAlign: 'right',
  },
  totalContainer: {
    marginTop: 30,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  totalBox: {
    width: 200,
    padding: 15,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  grandTotalLabel: {
    fontSize: 14,
    fontWeight: 'bold',
  },
  grandTotalValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#115e59',
  },
  footer: {
    position: 'absolute',
    bottom: 40,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    paddingTop: 20,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 8,
  }
});

const InvoicePDF = ({ booking, invoiceNumber, date }) => {
  const basePrice = parseFloat(booking.service_price || 0);
  // The held total is the booking's held amount when one is recorded, else the price.
  const heldAmount = booking.authorized_amount != null ? parseFloat(booking.authorized_amount) : null;
  const totalAmount = heldAmount != null ? heldAmount : basePrice;

  const formatArrayData = (data, isDate = false) => {
    if (!data) return 'N/A';
    try {
      const parsed = typeof data === 'string' && data.startsWith('[') ? JSON.parse(data) : data;
      if (Array.isArray(parsed)) {
        if (isDate) {
          return parsed.map(d => new Date(d.replace(/-/g, '/')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })).join(', ');
        }
        return parsed.join(', ');
      }
      if (isDate && typeof parsed === 'string' && !isNaN(Date.parse(parsed))) {
        return new Date(parsed.replace(/-/g, '/')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      }
      return String(parsed);
    } catch (error) {
      return String(data);
    }
  };

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Image src="/logo.png" style={styles.logo} alt="WorkOnTap Logo" />
            <Text style={{ color: '#64748b', marginTop: 4 }}>Professional Home Services</Text>
          </View>
          <View style={styles.invoiceMeta}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text style={styles.label}>Invoice No: {invoiceNumber}</Text>
            <Text style={styles.label}>Date: {date}</Text>
          </View>
        </View>

        <View style={styles.grid}>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Customer Details</Text>
            <Text style={styles.label}>Name</Text>
            <Text style={styles.value}>{booking.customer_first_name} {booking.customer_last_name}</Text>
            <Text style={styles.label}>Email</Text>
            <Text style={styles.value}>{booking.customer_email}</Text>
            <Text style={styles.label}>Phone</Text>
            <Text style={styles.value}>{booking.customer_phone}</Text>
            <Text style={styles.label}>Address</Text>
            <Text style={styles.value}>{booking.address_line1}, {booking.city}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Service Details</Text>
            <Text style={styles.label}>Service</Text>
            <Text style={styles.value}>{booking.service_name}</Text>
            <Text style={styles.label}>Booking ID</Text>
            <Text style={styles.value}>{booking.booking_number}</Text>
            <Text style={styles.label}>Job Date</Text>
            <Text style={styles.value}>{formatArrayData(booking.job_date, true)}</Text>
            <Text style={styles.label}>Time Slot</Text>
            <Text style={styles.value}>{formatArrayData(booking.job_time_slot)}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.tableColDesc}>Description</Text>
            <Text style={styles.tableColAmount}>Amount</Text>
          </View>
          
          <View style={styles.tableRow}>
            <View style={styles.tableColDesc}>
              <Text style={{ fontWeight: 'bold' }}>{booking.service_name}</Text>
              <Text style={{ color: '#64748b', fontSize: 9 }}>Base service charge</Text>
            </View>
            <Text style={styles.tableColAmount}>$ {basePrice.toFixed(2)}</Text>
          </View>

        </View>

        <View style={styles.totalContainer}>
          <View style={styles.totalBox}>
            <View style={styles.totalRow}>
              <Text style={styles.label}>Subtotal</Text>
              <Text style={styles.value}>$ {totalAmount.toFixed(2)}</Text>
            </View>
            <View style={styles.totalRow}>
              <Text style={styles.label}>Tax (0%)</Text>
              <Text style={styles.value}>$ 0.00</Text>
            </View>
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Total Authorized</Text>
              <Text style={styles.grandTotalValue}>$ {totalAmount.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <Text>Thank you for choosing WorkOnTap!</Text>
          <Text style={{ marginTop: 5 }}>This is a digital receipt for your service booking.</Text>
          <Text>WorkOnTap Inc. | Metro Vancouver, BC</Text>
        </View>
      </Page>
    </Document>
  );
};

export default InvoicePDF;
